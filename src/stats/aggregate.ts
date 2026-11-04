// 把 ChatEvent 流边读边汇总成年报数据（不保存消息列表，几 GB 的日志也只占很少内存）。
// 口径：
// - 「你」的统计只算本人发出的消息；定时任务、子代理、SDK 脚本单独记为「自动化」。
// - ChatGPT 本地加密缓存只有会话时间（role=session），计入活跃天数、时段分布和会话数，不计入消息数。

import type { ChatEvent, SourceId } from "../model";
import { SOURCE_LABEL } from "../model";
import { Keywords } from "./keywords";

export interface SourceStats {
  id: SourceId;
  label: string;
  userMsgs: number;
  replies: number;
  sessions: number;
  /** 只知道时间、读不到内容的会话数 */
  metaSessions: number;
  firstTs?: number;
  lastTs?: number;
}

export interface Moment {
  ts: number;
  source: string;
  snippet?: string;
}

export interface Stats {
  year: number;
  generatedAt: number;
  sources: SourceStats[];
  totals: {
    userMsgs: number;
    replies: number;
    sessions: number;
    activeDays: number;
    userChars: number;
    replyChars: number;
    toolCalls: number;
    outputTokens: number;
    automatedMsgs: number;
    automatedSessions: number;
  };
  vendors: Array<{ name: string; replies: number; share: number }>;
  models: Array<{ name: string; vendor: string; replies: number }>;
  hours: number[];
  weekdays: number[];
  /** YYYY-MM-DD → 当天本人消息数（含只有时间的会话） */
  daily: Record<string, number>;
  peakHour: number;
  firstMessage?: Moment;
  latestNight?: Moment;
  earliestMorning?: Moment;
  busiestDay?: { date: string; count: number; topSource: string };
  streak: { days: number; start?: string; end?: string };
  longestSession?: { title?: string; source: string; userMsgs: number; minutes: number; date: string };
  projects: Array<{ name: string; userMsgs: number }>;
  channels: Array<{ name: string; userMsgs: number }>;
  keywords: Array<{ word: string; count: number }>;
  catchphrase?: { text: string; count: number };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** 「晚」的程度：0–5 点算作前一天的 24–29 点 */
const lateness = (d: Date) => (d.getHours() < 6 ? d.getHours() + 24 : d.getHours()) * 60 + d.getMinutes();

function snippetOf(text: string | undefined, redact: boolean): string | undefined {
  if (redact || !text) return undefined;
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 28 ? one.slice(0, 28) + "…" : one;
}

interface SessionAcc {
  source: SourceId;
  title?: string;
  userMsgs: number;
  first: number;
  last: number;
  meta: boolean;
  automated: boolean;
}

export class Aggregator {
  private src = new Map<SourceId, SourceStats>();
  private sessions = new Map<string, SessionAcc>();
  private vendor = new Map<string, number>();
  private model = new Map<string, { vendor: string; replies: number }>();
  private project = new Map<string, number>();
  private channel = new Map<string, number>();
  private phrase = new Map<string, number>();
  private daySource = new Map<string, Map<string, number>>();
  private kw = new Keywords();
  private t = { userMsgs: 0, replies: 0, userChars: 0, replyChars: 0, toolCalls: 0, outputTokens: 0, automatedMsgs: 0 };
  private hours = new Array(24).fill(0);
  private weekdays = new Array(7).fill(0);
  private daily: Record<string, number> = {};
  private first?: { ts: number; ev: ChatEvent };
  private late?: { score: number; ev: ChatEvent };
  private early?: { score: number; ev: ChatEvent };

  constructor(
    private year: number,
    private redact = false,
  ) {}

  private source(id: SourceId): SourceStats {
    let s = this.src.get(id);
    if (!s) {
      s = { id, label: SOURCE_LABEL[id], userMsgs: 0, replies: 0, sessions: 0, metaSessions: 0 };
      this.src.set(id, s);
    }
    return s;
  }

  add(ev: ChatEvent): void {
    const s = this.source(ev.source);
    const key = `${ev.source}:${ev.sessionId}`;
    let sess = this.sessions.get(key);
    if (!sess) {
      sess = { source: ev.source, title: ev.sessionTitle, userMsgs: 0, first: ev.ts, last: ev.ts, meta: ev.role === "session", automated: true };
      this.sessions.set(key, sess);
    }
    sess.first = Math.min(sess.first, ev.ts);
    sess.last = Math.max(sess.last, ev.ts);
    if (ev.sessionTitle && !sess.title) sess.title = ev.sessionTitle;
    if (ev.role !== "session") sess.meta = false;

    if (ev.automated) {
      if (ev.role === "user") this.t.automatedMsgs++;
      return;
    }

    if (ev.role === "assistant") {
      sess.automated = false;
      s.replies++;
      this.t.replies++;
      this.t.replyChars += ev.chars;
      this.t.toolCalls += ev.toolCalls ?? 0;
      this.t.outputTokens += ev.outputTokens ?? 0;
      this.vendor.set(ev.vendor, (this.vendor.get(ev.vendor) ?? 0) + 1);
      if (ev.model) {
        const m = this.model.get(ev.model) ?? { vendor: ev.vendor, replies: 0 };
        m.replies++;
        this.model.set(ev.model, m);
      }
      return;
    }
    if (ev.role !== "user" && ev.role !== "session") return;

    // 本人活动（消息或只有时间的会话）
    sess.automated = false;
    const d = new Date(ev.ts);
    const day = dateKey(ev.ts);
    this.hours[d.getHours()]++;
    this.weekdays[d.getDay()]++;
    this.daily[day] = (this.daily[day] ?? 0) + 1;
    const ds = this.daySource.get(day) ?? new Map<string, number>();
    ds.set(s.label, (ds.get(s.label) ?? 0) + 1);
    this.daySource.set(day, ds);
    s.firstTs = Math.min(s.firstTs ?? ev.ts, ev.ts);
    s.lastTs = Math.max(s.lastTs ?? ev.ts, ev.ts);
    if (ev.role === "session") return;

    sess.userMsgs++;
    s.userMsgs++;
    this.t.userMsgs++;
    this.t.userChars += ev.chars;
    if (ev.project) this.project.set(ev.project, (this.project.get(ev.project) ?? 0) + 1);
    if (ev.channel) this.channel.set(ev.channel, (this.channel.get(ev.channel) ?? 0) + 1);
    if (!this.first || ev.ts < this.first.ts) this.first = { ts: ev.ts, ev };
    const late = lateness(d);
    if (!this.late || late > this.late.score) this.late = { score: late, ev };
    const h = d.getHours();
    if (h >= 4 && h < 9) {
      const early = h * 60 + d.getMinutes();
      if (!this.early || early < this.early.score) this.early = { score: early, ev };
    }
    if (ev.text) {
      this.kw.add(ev.text);
      const p = ev.text.trim().replace(/[\s。！!？?，,.~～…]+$/g, "");
      if (p.length >= 1 && p.length <= 12 && !p.startsWith("/")) this.phrase.set(p, (this.phrase.get(p) ?? 0) + 1);
    }
  }

  finish(): Stats {
    let sessions = 0;
    let automatedSessions = 0;
    let longest: SessionAcc | undefined;
    for (const sess of this.sessions.values()) {
      if (sess.automated) {
        automatedSessions++;
        continue;
      }
      sessions++;
      const s = this.source(sess.source);
      s.sessions++;
      if (sess.meta) s.metaSessions++;
      if (!longest || sess.userMsgs > longest.userMsgs) longest = sess;
    }
    const days = Object.keys(this.daily).sort();
    const streak = longestStreak(days);
    const totalReplies = [...this.vendor.values()].reduce((a, b) => a + b, 0) || 1;
    const busiest = Object.entries(this.daily).sort((a, b) => b[1] - a[1])[0];
    const moment = (x?: { ev: ChatEvent }): Moment | undefined =>
      x && { ts: x.ev.ts, source: SOURCE_LABEL[x.ev.source], snippet: snippetOf(x.ev.text, this.redact) };
    const phrase = [...this.phrase.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      year: this.year,
      generatedAt: Date.now(),
      sources: [...this.src.values()].sort((a, b) => b.userMsgs + b.metaSessions - (a.userMsgs + a.metaSessions)),
      totals: { ...this.t, sessions, activeDays: days.length, automatedSessions },
      vendors: [...this.vendor.entries()]
        .map(([name, replies]) => ({ name, replies, share: replies / totalReplies }))
        .sort((a, b) => b.replies - a.replies),
      models: [...this.model.entries()]
        .map(([name, m]) => ({ name, vendor: m.vendor, replies: m.replies }))
        .sort((a, b) => b.replies - a.replies)
        .slice(0, 8),
      hours: this.hours,
      weekdays: this.weekdays,
      daily: this.daily,
      peakHour: this.hours.indexOf(Math.max(...this.hours)),
      firstMessage: moment(this.first),
      latestNight: moment(this.late),
      earliestMorning: moment(this.early),
      busiestDay: busiest && {
        date: busiest[0],
        count: busiest[1],
        topSource: [...(this.daySource.get(busiest[0]) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      },
      streak,
      longestSession:
        longest && longest.userMsgs > 0
          ? {
          title: this.redact ? undefined : longest.title,
          source: SOURCE_LABEL[longest.source],
          userMsgs: longest.userMsgs,
          minutes: Math.round((longest.last - longest.first) / 60000),
          date: dateKey(longest.first),
        }
          : undefined,
      projects: top(this.project, 6).map(([name, userMsgs]) => ({ name, userMsgs })),
      channels: top(this.channel, 6).map(([name, userMsgs]) => ({ name, userMsgs })),
      keywords: this.kw.top(24),
      catchphrase: phrase && phrase[1] >= 3 ? { text: phrase[0], count: phrase[1] } : undefined,
    };
  }
}

function top(m: Map<string, number>, n: number): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function longestStreak(sortedDays: string[]): { days: number; start?: string; end?: string } {
  let best = { days: 0, start: undefined as string | undefined, end: undefined as string | undefined };
  let runStart = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    if (i > 0) {
      const gap = (Date.parse(sortedDays[i]!) - Date.parse(sortedDays[i - 1]!)) / 86400000;
      if (Math.round(gap) !== 1) runStart = i;
    }
    const len = i - runStart + 1;
    if (len > best.days) best = { days: len, start: sortedDays[runStart], end: sortedDays[i] };
  }
  return best;
}
