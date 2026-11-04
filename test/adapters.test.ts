import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatgptAdapter } from "../src/adapters/chatgpt";
import { claudeCodeAdapter } from "../src/adapters/claude-code";
import { hermesAdapter } from "../src/adapters/hermes";
import type { ChatEvent } from "../src/model";
import { vendorOf } from "../src/vendor";

const FIX = join(import.meta.dir, "fixtures");
const Y2026 = { from: new Date(2026, 0, 1).getTime(), to: new Date(2027, 0, 1).getTime() };

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("vendorOf", () => {
  test("按模型名归类", () => {
    expect(vendorOf("deepseek-v4-pro")).toBe("DeepSeek");
    expect(vendorOf("glm-5.2")).toBe("智谱 GLM");
    expect(vendorOf("claude-opus-5-5")).toBe("Anthropic");
    expect(vendorOf("gpt-5")).toBe("OpenAI");
    expect(vendorOf("mimo-v2.5-pro")).toBe("小米 MiMo");
    expect(vendorOf(undefined, "OpenAI")).toBe("OpenAI");
  });
});

describe("Claude Code", () => {
  test("解析用户消息、合并同一回复、跳过元信息与去年的消息", async () => {
    const evs = await collect(claudeCodeAdapter(join(FIX, "claude")).scan(Y2026));
    const users = evs.filter((e) => e.role === "user" && !e.automated);
    expect(users.map((u) => u.text)).toEqual(["帮我写一个年报生成器，读取聊天记录", "/review v1", "人打的字"]); // 后台任务通知不算
    expect(users[1]!.project).toBe("proj"); // worktree 归到所属仓库
    const replies = evs.filter((e) => e.role === "assistant");
    expect(replies).toHaveLength(1); // 两行同一 message.id 合并；<synthetic> 跳过
    expect(replies[0]!.toolCalls).toBe(1);
    expect(replies[0]!.outputTokens).toBe(42);
    expect(evs.find((e) => e.automated)?.text).toBe("子代理的提示");
    expect(evs.every((e) => e.sessionTitle === "做一个年报生成器")).toBe(true);
  });
});

describe("ChatGPT", () => {
  test("导出包：用户消息、工具调用、隐藏消息", async () => {
    const evs = await collect(chatgptAdapter([join(FIX, "chatgpt-conversations.json")], []).scan(Y2026));
    expect(evs.filter((e) => e.role === "user").map((e) => e.text)).toEqual(["周末去哪里玩比较好"]);
    const replies = evs.filter((e) => e.role === "assistant");
    expect(replies).toHaveLength(2);
    expect(replies.reduce((a, e) => a + (e.toolCalls ?? 0), 0)).toBe(1);
    expect(evs.every((e) => e.vendor === "OpenAI" && e.sessionTitle === "周末出游计划")).toBe(true);
  });

  test("本地加密缓存：只记会话时间，导出包里有的会话不重复", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-gpt-"));
    try {
      const dir = join(root, "com.openai.chat", "conversations-v3-x");
      await mkdir(dir, { recursive: true });
      const t = new Date(2026, 5, 1, 23, 30).getTime() / 1000;
      for (const id of ["AAAA-1111", "BBBB-2222"]) {
        await writeFile(join(dir, `${id}.data`), new Uint8Array([1, 2, 3]));
        await utimes(join(dir, `${id}.data`), t, t);
      }
      const a = chatgptAdapter([join(FIX, "chatgpt-conversations.json")], [join(root, "com.openai.chat")]);
      const meta = (await collect(a.scan(Y2026))).filter((e) => e.role === "session");
      expect(meta.map((e) => e.sessionId)).toEqual(["bbbb-2222"]);
      expect(new Date(meta[0]!.ts).getHours()).toBe(23);
      expect((await a.detect()).detail).toContain("2 个会话");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Hermes（DeepSeek）", () => {
  test("按模型归厂商，定时任务标为自动化", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aw-hermes-"));
    const path = join(dir, "state.db");
    try {
      const db = new Database(path);
      db.run(`create table sessions (id text primary key, source text, model text, title text, cwd text, git_repo_root text)`);
      db.run(`create table messages (id integer primary key, session_id text, role text, content text, tool_calls text,
              timestamp real, token_count integer)`);
      const t = new Date(2026, 7, 14, 1, 20).getTime() / 1000;
      db.run(`insert into sessions values ('a','weixin','deepseek-v4-pro','微信聊天',null,null),
                                          ('b','cron','deepseek-v4-pro',null,null,null)`);
      db.run(`insert into messages (session_id,role,content,tool_calls,timestamp,token_count) values
              ('a','user','今晚帮我整理一下日程',null,${t},null),
              ('a','assistant','好的','[{"id":1},{"id":2}]',${t + 5},88),
              ('a','tool','{}',null,${t + 6},null),
              ('a','session_meta','x',null,${t + 7},null),
              ('b','user','定时汇报',null,${t + 60},null)`);
      db.close();
      const evs = await collect(hermesAdapter(path).scan(Y2026));
      expect(evs).toHaveLength(4);
      expect(evs.every((e) => e.vendor === "DeepSeek")).toBe(true);
      expect(evs.find((e) => e.role === "assistant")?.toolCalls).toBe(2);
      expect(evs.filter((e) => e.automated).map((e) => e.text)).toEqual(["定时汇报"]);
      expect(evs[0]!.channel).toBe("weixin");
      expect((await hermesAdapter(path).detect()).detail).toContain("DeepSeek 2 个");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
