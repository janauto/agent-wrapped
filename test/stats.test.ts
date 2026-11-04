import { describe, expect, test } from "bun:test";
import type { ChatEvent } from "../src/model";
import { Aggregator, longestStreak } from "../src/stats/aggregate";
import { Keywords } from "../src/stats/keywords";
import { persona } from "../src/stats/persona";
import { renderReport } from "../src/report/html";

const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const user = (ts: number, text: string, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  source: "claude-code",
  vendor: "Anthropic",
  sessionId: "s1",
  role: "user",
  ts,
  chars: text.length,
  text,
  project: "agent-wrapped",
  ...extra,
});

describe("Aggregator", () => {
  const agg = new Aggregator(2026);
  agg.add(user(at(1, 2, 9), "第一句：做个年报"));
  agg.add(user(at(1, 3, 2, 40), "继续"));
  agg.add(user(at(1, 4, 14), "继续"));
  agg.add(user(at(1, 4, 15), "继续", { sessionId: "s2", source: "hermes", vendor: "DeepSeek" }));
  agg.add({ source: "hermes", vendor: "DeepSeek", model: "deepseek-v4-pro", sessionId: "s2", role: "assistant", ts: at(1, 4, 15, 1), chars: 5, toolCalls: 3 });
  agg.add(user(at(1, 4, 16), "定时任务", { sessionId: "cron", automated: true }));
  agg.add({ source: "chatgpt", vendor: "OpenAI", sessionId: "g1", role: "session", ts: at(2, 1, 23), chars: 0 });
  const s = agg.finish();

  test("总量与口径", () => {
    expect(s.totals.userMsgs).toBe(4); // 自动化和只有时间的会话不算消息
    expect(s.totals.sessions).toBe(3); // s1、s2、ChatGPT 缓存会话
    expect(s.totals.automatedSessions).toBe(1);
    expect(s.totals.automatedMsgs).toBe(1);
    expect(s.totals.activeDays).toBe(4); // 含 ChatGPT 缓存会话那天
    expect(s.totals.toolCalls).toBe(3);
  });

  test("时刻与连续天数", () => {
    expect(s.firstMessage?.snippet).toBe("第一句：做个年报");
    expect(new Date(s.latestNight!.ts).getHours()).toBe(2); // 凌晨 2:40 比下午更「晚」
    expect(s.busiestDay).toMatchObject({ date: "2026-01-04", count: 2 });
    expect(s.streak).toMatchObject({ days: 3, start: "2026-01-02", end: "2026-01-04" });
    expect(s.catchphrase).toEqual({ text: "继续", count: 3 });
    expect(s.vendors[0]).toMatchObject({ name: "DeepSeek", share: 1 });
  });

  test("redact 不输出原话和标题", () => {
    const a = new Aggregator(2026, true);
    a.add(user(at(3, 1, 10), "隐私内容", { sessionTitle: "私人标题" }));
    const r = a.finish();
    expect(r.firstMessage?.snippet).toBeUndefined();
    expect(r.longestSession?.title).toBeUndefined();
  });

  test("年报 HTML 能生成且转义", () => {
    const html = renderReport(s, persona(s), [{ label: "Claude Code", detail: "<script>x</script>" }]);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // 不加载外部资源
  });
});

test("longestStreak 跨月", () => {
  expect(longestStreak(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-03"])).toEqual({
    days: 3,
    start: "2026-01-30",
    end: "2026-02-01",
  });
});

test("Keywords 去掉代码、路径和停用词", () => {
  const k = new Keywords();
  k.add("帮我看看固件的蓝牙问题 `rm -rf /` 路径 /Users/x/a.ts https://x.com BLE");
  k.add("固件又挂了");
  const words = k.top(10).map((x) => x.word);
  expect(words[0]).toBe("固件");
  expect(words).toContain("BLE");
  expect(words).not.toContain("帮我");
  expect(words.some((w) => w.includes("Users") || w.includes("https"))).toBe(false);
});
