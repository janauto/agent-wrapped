// Hermes Agent：~/.hermes/state.db（SQLite，WAL）。
// DeepSeek 这类没有桌面应用的模型常跑在这里，经微信 / 桌面 / 命令行 / 定时任务等渠道。
// 厂商按会话模型名归类，所以同一个库里的 MiMo、Claude 会话也会各归各家。

import { Database } from "bun:sqlite";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter, ChatEvent, ScanOptions } from "../model";
import { vendorOf } from "../vendor";
import { exists, home, projectOf } from "../util";

/** 不是本人发起的渠道 */
const AUTOMATED_SOURCES = new Set(["cron", "subagent"]);

/** 只读打开；被占用或 WAL 不可读时复制一份到临时目录再读，读完删掉 */
async function openReadonly(path: string): Promise<{ db: Database; cleanup: () => Promise<void> }> {
  try {
    const db = new Database(path, { readonly: true });
    db.query("select 1 from sessions limit 1").get();
    return { db, cleanup: async () => db.close() };
  } catch {
    const dir = await mkdtemp(join(tmpdir(), "agent-wrapped-"));
    const copy = join(dir, "state.db");
    await copyFile(path, copy);
    for (const ext of ["-wal", "-shm"]) if (await exists(path + ext)) await copyFile(path + ext, copy + ext);
    const db = new Database(copy);
    return {
      db,
      cleanup: async () => {
        db.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
}

function countToolCalls(raw: string | null): number {
  if (!raw) return 0;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

export function hermesAdapter(dbPath = join(home(), ".hermes", "state.db")): Adapter {
  return {
    id: "hermes",
    label: "Hermes Agent",
    async detect() {
      if (!(await exists(dbPath))) return { found: false, detail: `未找到 ${dbPath}` };
      const { db, cleanup } = await openReadonly(dbPath);
      try {
        const r = db.query("select count(*) n, sum(model like '%deepseek%') d from sessions").get() as any;
        return { found: true, detail: `${dbPath}：${r.n} 个会话（其中 DeepSeek ${r.d ?? 0} 个）` };
      } finally {
        await cleanup();
      }
    },
    async *scan({ from, to }: ScanOptions) {
      if (!(await exists(dbPath))) return;
      const { db, cleanup } = await openReadonly(dbPath);
      try {
        // Hermes 的 token 用量记在会话级（messages.token_count 基本为空）：
        // 整个会话的输出 token 记到该会话在统计区间内的第一次回复上。
        const usage = new Map<string, number>();
        try {
          for (const u of db.query("select session_id sid, sum(output_tokens) t from session_model_usage group by 1").all() as any[])
            if (u.t > 0) usage.set(u.sid, u.t);
        } catch {
          for (const u of db.query("select id sid, output_tokens t from sessions where output_tokens > 0").all() as any[])
            usage.set(u.sid, u.t);
        }
        const rows = db
          .query(
            `select m.session_id sid, m.role, m.content, m.tool_calls, m.timestamp ts, m.token_count tok,
                    s.model, s.source, s.title, coalesce(s.git_repo_root, s.cwd) cwd
               from messages m join sessions s on s.id = m.session_id
              where m.timestamp >= ? and m.timestamp < ? and m.role in ('user','assistant','tool')
              order by m.timestamp`,
          )
          .iterate(from / 1000, to / 1000);
        for (const r of rows as Iterable<any>) {
          const content: string = typeof r.content === "string" ? r.content : "";
          const ev: ChatEvent = {
            source: "hermes",
            vendor: vendorOf(r.model),
            model: r.model ?? undefined,
            sessionId: r.sid,
            sessionTitle: r.title ?? undefined,
            project: projectOf(r.cwd),
            channel: r.source ?? undefined,
            role: r.role,
            ts: Math.round(r.ts * 1000),
            chars: r.role === "tool" ? 0 : content.length,
            automated: AUTOMATED_SOURCES.has(r.source),
          };
          if (r.role === "user") ev.text = content;
          if (r.role === "assistant") {
            ev.toolCalls = countToolCalls(r.tool_calls);
            if (typeof r.tok === "number") ev.outputTokens = r.tok;
            else if (usage.has(r.sid)) {
              ev.outputTokens = usage.get(r.sid);
              usage.delete(r.sid);
            }
          }
          yield ev;
        }
      } finally {
        await cleanup();
      }
    },
  };
}
