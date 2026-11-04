// Claude Code：~/.claude/projects/<项目>/<会话>.jsonl（含子代理 subagents/*.jsonl）
// 每行一条记录；assistant 回复按内容块拆成多行，同一 message.id 要合并成一次回复。

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter, ChatEvent, ScanOptions } from "../model";
import { vendorOf } from "../vendor";
import { exists, home, projectOf, readLines, walk } from "../util";

/** 不是本人打字的 user 文本：命令输出、系统注入、中断提示 */
const NOT_TYPED = /^\s*(<local-command-|<system-reminder>|<task-notification>|\[Request interrupted|Caveat: )/;

function cleanUserText(s: string): string | undefined {
  if (NOT_TYPED.test(s)) return undefined;
  // 斜杠命令：只保留命令名和参数
  const cmd = s.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = s.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? "";
    return `${cmd[1]} ${args}`.trim();
  }
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim() || undefined;
}

export function claudeCodeAdapter(root = join(home(), ".claude", "projects")): Adapter {
  return {
    id: "claude-code",
    label: "Claude Code",
    async detect() {
      if (!(await exists(root))) return { found: false, detail: `未找到 ${root}` };
      let n = 0;
      for await (const _ of walk(root, ".jsonl")) n++;
      return { found: n > 0, detail: `${root} 下 ${n} 个会话文件` };
    },
    async *scan({ from, to }: ScanOptions) {
      for await (const file of walk(root, ".jsonl")) {
        // 最后修改早于统计起点的文件不可能有区间内的消息，直接跳过
        try {
          if ((await stat(file)).mtimeMs < from) continue;
        } catch {
          continue;
        }
        yield* scanFile(file, from, to);
      }
    },
  };
}

async function* scanFile(file: string, from: number, to: number): AsyncIterable<ChatEvent> {
  const titles = new Map<string, string>();
  const replies = new Map<string, ChatEvent>(); // message.id → 合并后的回复
  const pending: ChatEvent[] = [];

  for await (const line of readLines(file)) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('"type":"custom-title"'))
      continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === "custom-title") {
      if (o.customTitle && o.sessionId) titles.set(o.sessionId, o.customTitle);
      continue;
    }
    const ts = Date.parse(o.timestamp);
    if (!Number.isFinite(ts) || ts < from || ts >= to) continue;
    const msg = o.message;
    if (!msg || typeof msg !== "object") continue;
    const automated = Boolean(o.isSidechain) || String(o.entrypoint ?? "").startsWith("sdk");
    const base = {
      source: "claude-code" as const,
      sessionId: String(o.sessionId ?? file),
      project: projectOf(o.cwd),
      automated,
      ts,
    };

    if (o.type === "user") {
      if (o.isMeta) continue;
      // 新版日志用 origin.kind 标明来源：human 才是本人打字；后台任务通知、协调者转发等都不算
      const kind = o.origin?.kind;
      if (kind && kind !== "human") continue;
      const c = msg.content;
      if (typeof c === "string") {
        const text = cleanUserText(c);
        if (text) pending.push({ ...base, vendor: "Anthropic", role: "user", chars: text.length, text });
      } else if (Array.isArray(c)) {
        const texts: string[] = [];
        let toolResults = 0;
        for (const b of c) {
          if (b?.type === "text" && typeof b.text === "string") {
            const t = cleanUserText(b.text);
            if (t) texts.push(t);
          } else if (b?.type === "tool_result") toolResults++;
        }
        if (texts.length) {
          const text = texts.join("\n");
          pending.push({ ...base, vendor: "Anthropic", role: "user", chars: text.length, text });
        } else if (toolResults) {
          pending.push({ ...base, vendor: "Anthropic", role: "tool", chars: 0 });
        }
      }
      continue;
    }

    // assistant
    const model: string | undefined = msg.model;
    if (!model || model === "<synthetic>") continue;
    const id = String(msg.id ?? o.uuid);
    let ev = replies.get(id);
    if (!ev) {
      ev = { ...base, vendor: vendorOf(model, "Anthropic"), model, role: "assistant", chars: 0, toolCalls: 0 };
      replies.set(id, ev);
      pending.push(ev);
    }
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (b?.type === "text" && typeof b.text === "string") ev.chars += b.text.length;
      else if (b?.type === "tool_use" || b?.type === "server_tool_use") ev.toolCalls = (ev.toolCalls ?? 0) + 1;
    }
    const out = msg.usage?.output_tokens;
    if (typeof out === "number") ev.outputTokens = Math.max(ev.outputTokens ?? 0, out);
  }

  for (const ev of pending) {
    const t = titles.get(ev.sessionId);
    if (t) ev.sessionTitle = t;
    yield ev;
  }
}
