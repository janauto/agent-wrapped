import { describe, expect, test } from "bun:test";
import type { ChatEvent } from "../src/model";
import { DetailAggregator } from "../src/stats/detail";
import { renderAtlas } from "../src/report/atlas";

const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const ev = (e: Partial<ChatEvent> & Pick<ChatEvent, "role" | "ts">): ChatEvent => ({
  source: "claude-code",
  vendor: "Anthropic",
  sessionId: "s1",
  chars: 4,
  ...e,
});

function build(redact = false) {
  const d = new DetailAggregator(2026, redact);
  // 3 月 2 日（周一）上午：项目 A，两条消息 + 两次回复
  d.add(ev({ role: "user", ts: at(3, 2, 10, 0), project: "A", sessionTitle: "重构登录", text: "x" }));
  d.add(ev({ role: "assistant", ts: at(3, 2, 10, 1), model: "claude-opus-5-5", toolCalls: 2, outputTokens: 100 }));
  d.add(ev({ role: "user", ts: at(3, 2, 10, 40), project: "A" }));
  d.add(ev({ role: "assistant", ts: at(3, 2, 10, 41), model: "claude-opus-5-5", toolCalls: 1, outputTokens: 50 }));
  // 3 月 7 日（周六）深夜：Hermes 微信，无项目，DeepSeek
  d.add(ev({ source: "hermes", sessionId: "h1", channel: "weixin", vendor: "DeepSeek", role: "user", ts: at(3, 7, 23, 5) }));
  d.add(ev({ source: "hermes", sessionId: "h1", channel: "weixin", vendor: "DeepSeek", model: "deepseek-v4-pro", role: "assistant", ts: at(3, 7, 23, 6) }));
  // 定时任务：不计入本人
  d.add(ev({ source: "hermes", sessionId: "c1", channel: "cron", vendor: "DeepSeek", role: "user", ts: at(4, 1, 8), automated: true }));
  d.add(ev({ source: "hermes", sessionId: "c1", channel: "cron", vendor: "DeepSeek", role: "assistant", ts: at(4, 1, 8, 1), automated: true }));
  // 本人会话里子代理发出的指令：计入自动指令，但会话仍算本人
  d.add(ev({ role: "user", ts: at(3, 2, 10, 5), automated: true }));
  // ChatGPT 只有时间
  d.add(ev({ source: "chatgpt", sessionId: "g1", vendor: "OpenAI", role: "session", ts: at(5, 1, 20) }));
  return d.finish();
}

describe("DetailAggregator", () => {
  const d = build();

  test("覆盖范围按来源拆开，自动化单列", () => {
    const cc = d.coverage.find((c) => c.label === "Claude Code")!;
    expect(cc).toMatchObject({ sessions: 1, userMsgs: 2, replies: 2, toolCalls: 3, outputTokens: 150, activeDays: 1 });
    const h = d.coverage.find((c) => c.label === "Hermes Agent")!;
    expect(h).toMatchObject({ sessions: 1, userMsgs: 1, automatedSessions: 1, automatedMsgs: 1 });
    const g = d.coverage.find((c) => c.label === "ChatGPT")!;
    expect(g).toMatchObject({ sessions: 1, metaSessions: 1, userMsgs: 0, activeDays: 1 });
    expect(d.automation).toEqual([
      { source: "Hermes Agent", channel: "cron", sessions: 1, msgs: 1 },
      { source: "Claude Code", channel: "子代理 / 脚本", sessions: 0, msgs: 1 },
    ]);
  });

  test("月度、时长、工作时段", () => {
    const mar = d.months.find((m) => m.month === "2026-03")!;
    expect(mar).toMatchObject({ activeDays: 2, sessions: 2, userMsgs: 3, replies: 3, toolCalls: 3 });
    expect(d.months).toHaveLength(12);
    // 10:00、10:30（10:40/10:41）、23:00 三个 15 分钟格；10:01 与 10:00 同格
    expect(d.engagedHours).toBeCloseTo(0.75);
    expect(d.workShare).toBeCloseTo(2 / 3);
    expect(d.weekendDays).toBe(1);
    expect(d.matrix[1]![10]).toBe(2);
  });

  test("项目、会话、厂商", () => {
    expect(d.projects).toEqual([
      expect.objectContaining({ name: "A", sessions: 1, userMsgs: 2, replies: 2, toolCalls: 3, activeDays: 1, sources: ["Claude Code"] }),
    ]);
    expect(d.unassignedMsgs).toBe(1);
    expect(d.sessions[0]).toMatchObject({ title: "重构登录", project: "A", userMsgs: 2, replies: 2 });
    expect(d.vendors.map((v) => [v.name, v.replies, v.sessions])).toEqual([
      ["Anthropic", 2, 1],
      ["DeepSeek", 1, 1],
    ]);
  });

  test("redact 隐藏会话标题", () => {
    expect(build(true).sessions[0]!.title).toBeUndefined();
  });

  test("图鉴页能生成、转义、不加载外部资源", () => {
    const html = renderAtlas(d, [{ label: "Claude Code", detail: "<b>x</b>" }], { version: "0.0.1", command: "bun run wrapped", redacted: false });
    expect(html).toContain("Agent 使用图鉴 2026");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("重构登录");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});
