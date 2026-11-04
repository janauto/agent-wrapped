// ChatGPT 有两路数据：
// 1. 官方导出包（设置 → 数据控制 → 导出数据），zip 里的 conversations*.json 有完整对话 → 全量统计。
// 2. 桌面版 / Atlas 的本地缓存 conversations-v3-*/<会话ID>.data：内容是 AES-GCM 加密的，
//    密钥放在只有 ChatGPT 自己能读的系统钥匙串分区里，外部程序解不开。
//    这里只读文件名和修改时间，记成「这里有一个会话、最后活跃于何时」，不读内容。
// 导出包里已有的会话，不再重复计入本地缓存。

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Adapter, ChatEvent, ScanOptions } from "../model";
import { vendorOf } from "../vendor";
import { exists, home, walk } from "../util";

const CACHE_APPS = ["com.openai.chat", "com.openai.atlas"];

export function defaultCacheRoots(): string[] {
  return CACHE_APPS.map((a) => join(home(), "Library", "Application Support", a));
}

/** 读取导出包：zip / 目录 / 单个 json，返回所有会话对象 */
export async function loadExport(path: string): Promise<any[]> {
  const info = await stat(path);
  const out: any[] = [];
  const add = (text: string) => {
    const v = JSON.parse(text);
    if (Array.isArray(v)) out.push(...v);
  };
  if (info.isDirectory()) {
    for await (const f of walk(path, ".json")) if (/^conversations.*\.json$/.test(basename(f))) add(await Bun.file(f).text());
  } else if (path.endsWith(".zip")) {
    const list = await new Response(Bun.spawn(["unzip", "-Z1", path]).stdout).text();
    for (const name of list.split("\n").filter((n) => /(^|\/)conversations.*\.json$/.test(n))) {
      add(await new Response(Bun.spawn(["unzip", "-p", path, name]).stdout).text());
    }
  } else {
    add(await Bun.file(path).text());
  }
  return out;
}

function partsText(content: any): string {
  if (!content) return "";
  if (Array.isArray(content.parts)) return content.parts.filter((p: any) => typeof p === "string").join("\n");
  if (typeof content.text === "string") return content.text;
  return "";
}

export function* exportEvents(convs: any[], from: number, to: number): Iterable<ChatEvent> {
  for (const c of convs) {
    const sessionId = String(c.conversation_id ?? c.id ?? "").toLowerCase();
    const title: string | undefined = c.title ?? undefined;
    for (const node of Object.values<any>(c.mapping ?? {})) {
      const m = node?.message;
      if (!m || !m.create_time) continue;
      if (m.metadata?.is_visually_hidden_from_conversation) continue;
      const ts = Math.round(m.create_time * 1000);
      if (ts < from || ts >= to) continue;
      const role = m.author?.role;
      const text = partsText(m.content);
      const model: string | undefined = m.metadata?.model_slug ?? c.default_model_slug ?? undefined;
      const base = { source: "chatgpt" as const, vendor: vendorOf(model, "OpenAI"), sessionId, sessionTitle: title, ts };
      if (role === "user") {
        if (!text.trim()) continue;
        yield { ...base, role: "user", chars: text.length, text };
      } else if (role === "assistant") {
        const toolCall = m.recipient && m.recipient !== "all";
        yield { ...base, model, role: "assistant", chars: toolCall ? 0 : text.length, toolCalls: toolCall ? 1 : 0 };
      } else if (role === "tool") {
        yield { ...base, role: "tool", chars: 0 };
      }
    }
  }
}

/** 本地加密缓存：每个 .data 文件是一个会话，只取修改时间 */
async function* cacheEvents(roots: string[], skip: Set<string>, from: number, to: number): AsyncIterable<ChatEvent> {
  for (const root of roots) {
    let dirs: string[];
    try {
      dirs = (await readdir(root)).filter((d) => d.startsWith("conversations-v"));
    } catch {
      continue;
    }
    for (const d of dirs) {
      let files: string[];
      try {
        files = (await readdir(join(root, d))).filter((f) => f.endsWith(".data"));
      } catch {
        continue;
      }
      for (const f of files) {
        const id = f.replace(/\.data$/, "").toLowerCase();
        if (skip.has(id)) continue;
        skip.add(id); // 桌面版与 Atlas 可能缓存同一会话
        const st = await stat(join(root, d, f));
        if (st.mtimeMs < from || st.mtimeMs >= to) continue;
        yield { source: "chatgpt", vendor: "OpenAI", sessionId: id, role: "session", ts: Math.round(st.mtimeMs), chars: 0 };
      }
    }
  }
}

async function countCache(roots: string[]): Promise<number> {
  let n = 0;
  for (const root of roots) {
    let dirs: string[] = [];
    try {
      dirs = (await readdir(root)).filter((d) => d.startsWith("conversations-v"));
    } catch {}
    for (const d of dirs) n += (await readdir(join(root, d)).catch(() => [])).filter((f) => f.endsWith(".data")).length;
  }
  return n;
}

export function chatgptAdapter(imports: string[] = [], cacheRoots = defaultCacheRoots()): Adapter {
  return {
    id: "chatgpt",
    label: "ChatGPT",
    async detect() {
      const parts: string[] = [];
      for (const p of imports) parts.push((await exists(p)) ? `导出包 ${p}` : `导出包不存在：${p}`);
      const n = await countCache(cacheRoots);
      if (n) parts.push(`本地加密缓存 ${n} 个会话（只能读到时间，内容需导入官方导出包）`);
      return { found: parts.length > 0, detail: parts.join("；") || "未找到 ChatGPT 桌面版缓存，也没有导入导出包" };
    },
    async *scan({ from, to }: ScanOptions) {
      const seen = new Set<string>();
      for (const p of imports) {
        if (!(await exists(p))) continue;
        const convs = await loadExport(p);
        for (const c of convs) seen.add(String(c.conversation_id ?? c.id ?? "").toLowerCase());
        yield* exportEvents(convs, from, to);
      }
      yield* cacheEvents(cacheRoots, seen, from, to);
    },
  };
}
