// 图鉴用的明细汇总：按来源、月份、项目、会话、模型拆开，给人力核查或主管查看。
// 和年报（aggregate.ts）吃同一条事件流，但只算可核对的数字，不做趣味解读。
// 口径与年报一致：自动化（定时任务、子代理、脚本）单独列，不混进本人数据。

import type { ChatEvent, SourceId } from "../model";
import { SOURCE_LABEL } from "../model";
import { dateKey } from "./aggregate";

/** 「AI 参与时长」的计时粒度：有本人消息或 AI 回复的 15 分钟时段算一格 */
export const SLOT_MINUTES = 15;

export interface CoverageRow {
  label: string;
  firstTs?: number;
  lastTs?: number;
  activeDays: number;
  sessions: number;
  metaSessions: number;
  userMsgs: number;
  replies: number;
  toolCalls: number;
  outputTokens: number;
  automatedSessions: number;
  automatedMsgs: number;
}

export interface MonthRow {
  month: string; // YYYY-MM
  activeDays: number;
  sessions: number;
  userMsgs: number;
  replies: number;
  toolCalls: number;
  hours: number;
}

export interface ProjectRow {
  name: string;
  sessions: number;
  userMsgs: number;
  replies: number;
  toolCalls: number;
  activeDays: number;
  firstTs: number;
  lastTs: number;
  sources: string[];
}

export interface SessionRow {
  title?: string;
  source: string;
  project?: string;
  start: number;
  end: number;
  userMsgs: number;
  replies: number;
  toolCalls: number;
}

export interface Detail {
  year: number;
  from: number;
  to: number;
  coverage: CoverageRow[];
  months: MonthRow[];
  /** [星期 0=周日][小时] → 本人消息数 */
  matrix: number[][];
  engagedHours: number;
  /** 本人消息中落在工作日 9:00–18:00 的比例 */
  workShare: number;
  weekendDays: number;
  vendors: Array<{ name: string; replies: number; outputTokens: number; sessions: number }>;
  models: Array<{ name: string; vendor: string; replies: number; outputTokens: number }>;
  projects: ProjectRow[];
  unassignedMsgs: number;
  sessions: SessionRow[];
  automation: Array<{ source: string; channel: string; sessions: number; msgs: number }>;
}

interface Sess {
  source: SourceId;
  title?: string;
  project?: string;
  channel?: string;
  first: number;
  last: number;
  userMsgs: number;
  replies: number;
  toolCalls: number;
  autoMsgs: number;
  human: boolean;
  meta: boolean;
  vendors: Set<string>;
}

interface Proj {
  sessions: Set<string>;
  days: Set<string>;
  sources: Set<string>;
  userMsgs: number;
  replies: number;
  toolCalls: number;
  first: number;
  last: number;
}

interface Src {
  days: Set<string>;
  userMsgs: number;
  replies: number;
  toolCalls: number;
  outputTokens: number;
  first?: number;
  last?: number;
}

const monthKey = (ts: number) => dateKey(ts).slice(0, 7);
const autoChannel = (source: SourceId, channel?: string) =>
  channel ?? (source === "claude-code" ? "子代理 / 脚本" : "其他");

export class DetailAggregator {
  private sess = new Map<string, Sess>();
  private src = new Map<SourceId, Src>();
  private proj = new Map<string, Proj>();
  private vendor = new Map<string, { replies: number; outputTokens: number }>();
  private model = new Map<string, { vendor: string; replies: number; outputTokens: number }>();
  private monthDays = new Map<string, Set<string>>();
  private month = new Map<string, { userMsgs: number; replies: number; toolCalls: number; slots: Set<number> }>();
  private slots = new Set<number>();
  private autoMsgs = new Map<string, number>(); // "来源|渠道" → 自动指令数
  private matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
  private days = new Set<string>();
  private userMsgs = 0;
  private workMsgs = 0;
  private unassigned = 0;

  constructor(
    private year: number,
    private redact = false,
  ) {}

  add(ev: ChatEvent): void {
    const key = `${ev.source}:${ev.sessionId}`;
    let s = this.sess.get(key);
    if (!s) {
      s = {
        source: ev.source,
        first: ev.ts,
        last: ev.ts,
        userMsgs: 0,
        replies: 0,
        toolCalls: 0,
        autoMsgs: 0,
        human: false,
        meta: true,
        vendors: new Set(),
      };
      this.sess.set(key, s);
    }
    s.first = Math.min(s.first, ev.ts);
    s.last = Math.max(s.last, ev.ts);
    s.title ??= ev.sessionTitle;
    s.project ??= ev.project;
    s.channel ??= ev.channel;
    if (ev.role !== "session") s.meta = false;

    if (ev.automated) {
      if (ev.role === "user") {
        s.autoMsgs++;
        // 按来源 + 渠道累计全部自动指令，含本人会话里子代理发出的，与年报口径一致
        const k = `${ev.source}|${autoChannel(ev.source, ev.channel)}`;
        this.autoMsgs.set(k, (this.autoMsgs.get(k) ?? 0) + 1);
      }
      return;
    }
    if (ev.role === "tool") return;

    const day = dateKey(ev.ts);
    const mk = monthKey(ev.ts);
    const src = this.srcOf(ev.source);
    const m = this.monthOf(mk);

    if (ev.role === "assistant") {
      s.replies++;
      s.toolCalls += ev.toolCalls ?? 0;
      s.vendors.add(ev.vendor);
      src.replies++;
      src.toolCalls += ev.toolCalls ?? 0;
      src.outputTokens += ev.outputTokens ?? 0;
      m.replies++;
      m.toolCalls += ev.toolCalls ?? 0;
      const v = this.vendor.get(ev.vendor) ?? { replies: 0, outputTokens: 0 };
      v.replies++;
      v.outputTokens += ev.outputTokens ?? 0;
      this.vendor.set(ev.vendor, v);
      if (ev.model) {
        const mo = this.model.get(ev.model) ?? { vendor: ev.vendor, replies: 0, outputTokens: 0 };
        mo.replies++;
        mo.outputTokens += ev.outputTokens ?? 0;
        this.model.set(ev.model, mo);
      }
      const p = ev.project ?? s.project;
      if (p) {
        const pr = this.projOf(p, ev.ts);
        pr.replies++;
        pr.toolCalls += ev.toolCalls ?? 0;
      }
      this.slot(ev.ts, m);
      return;
    }

    // 本人活动：消息，或只知道时间的会话
    s.human = true;
    this.days.add(day);
    src.days.add(day);
    src.first = Math.min(src.first ?? ev.ts, ev.ts);
    src.last = Math.max(src.last ?? ev.ts, ev.ts);
    const md = this.monthDays.get(mk) ?? new Set<string>();
    md.add(day);
    this.monthDays.set(mk, md);
    if (ev.role === "session") return;

    s.userMsgs++;
    src.userMsgs++;
    m.userMsgs++;
    this.userMsgs++;
    const d = new Date(ev.ts);
    const wd = d.getDay();
    const h = d.getHours();
    this.matrix[wd]![h]++;
    if (wd >= 1 && wd <= 5 && h >= 9 && h < 18) this.workMsgs++;
    this.slot(ev.ts, m);

    const p = ev.project ?? s.project;
    if (p) {
      const pr = this.projOf(p, ev.ts);
      pr.userMsgs++;
      pr.sessions.add(`${ev.source}:${ev.sessionId}`);
      pr.days.add(day);
      pr.sources.add(SOURCE_LABEL[ev.source]);
    } else this.unassigned++;
  }

  private slot(ts: number, m: { slots: Set<number> }) {
    const k = Math.floor(ts / (SLOT_MINUTES * 60000));
    this.slots.add(k);
    m.slots.add(k);
  }

  private srcOf(id: SourceId): Src {
    let s = this.src.get(id);
    if (!s) {
      s = { days: new Set(), userMsgs: 0, replies: 0, toolCalls: 0, outputTokens: 0 };
      this.src.set(id, s);
    }
    return s;
  }

  private monthOf(k: string) {
    let m = this.month.get(k);
    if (!m) {
      m = { userMsgs: 0, replies: 0, toolCalls: 0, slots: new Set<number>() };
      this.month.set(k, m);
    }
    return m;
  }

  private projOf(name: string, ts: number): Proj {
    let p = this.proj.get(name);
    if (!p) {
      p = { sessions: new Set(), days: new Set(), sources: new Set(), userMsgs: 0, replies: 0, toolCalls: 0, first: ts, last: ts };
      this.proj.set(name, p);
    }
    p.first = Math.min(p.first, ts);
    p.last = Math.max(p.last, ts);
    return p;
  }

  finish(): Detail {
    const from = new Date(this.year, 0, 1).getTime();
    const to = new Date(this.year + 1, 0, 1).getTime();
    const perHour = 60 / SLOT_MINUTES;

    // 会话归属：本人参与过的算本人会话，否则算自动化
    const cov = new Map<SourceId, CoverageRow>();
    const covOf = (id: SourceId) => {
      let c = cov.get(id);
      if (!c) {
        const s = this.srcOf(id);
        c = {
          label: SOURCE_LABEL[id],
          firstTs: s.first,
          lastTs: s.last,
          activeDays: s.days.size,
          sessions: 0,
          metaSessions: 0,
          userMsgs: s.userMsgs,
          replies: s.replies,
          toolCalls: s.toolCalls,
          outputTokens: s.outputTokens,
          automatedSessions: 0,
          automatedMsgs: 0,
        };
        cov.set(id, c);
      }
      return c;
    };
    const monthSessions = new Map<string, number>();
    const vendorSessions = new Map<string, number>();
    const auto = new Map<string, { source: string; channel: string; sessions: number; msgs: number }>();
    const human: Sess[] = [];
    for (const s of this.sess.values()) {
      const c = covOf(s.source);
      if (s.human) {
        c.sessions++;
        if (s.meta) c.metaSessions++;
        human.push(s);
        const mk = monthKey(s.first);
        monthSessions.set(mk, (monthSessions.get(mk) ?? 0) + 1);
        for (const v of s.vendors) vendorSessions.set(v, (vendorSessions.get(v) ?? 0) + 1);
      } else if (s.autoMsgs > 0 || s.replies === 0) {
        c.automatedSessions++;
        const ch = autoChannel(s.source, s.channel);
        const k = `${s.source}|${ch}`;
        const a = auto.get(k) ?? { source: c.label, channel: ch, sessions: 0, msgs: 0 };
        a.sessions++;
        auto.set(k, a);
      }
    }
    // 自动指令按「来源|渠道」全量计入（含本人会话内子代理发出的）
    for (const [k, msgs] of this.autoMsgs) {
      const [source, ch] = k.split("|") as [SourceId, string];
      const c = covOf(source);
      c.automatedMsgs += msgs;
      const a = auto.get(k) ?? { source: c.label, channel: ch, sessions: 0, msgs: 0 };
      a.msgs = msgs;
      auto.set(k, a);
    }

    const months: MonthRow[] = [];
    for (let i = 0; i < 12; i++) {
      const mk = `${this.year}-${String(i + 1).padStart(2, "0")}`;
      const m = this.month.get(mk);
      months.push({
        month: mk,
        activeDays: this.monthDays.get(mk)?.size ?? 0,
        sessions: monthSessions.get(mk) ?? 0,
        userMsgs: m?.userMsgs ?? 0,
        replies: m?.replies ?? 0,
        toolCalls: m?.toolCalls ?? 0,
        hours: (m?.slots.size ?? 0) / perHour,
      });
    }

    let weekendDays = 0;
    for (const d of this.days) {
      const wd = new Date(`${d}T12:00:00`).getDay();
      if (wd === 0 || wd === 6) weekendDays++;
    }

    return {
      year: this.year,
      from,
      to,
      coverage: [...cov.values()].sort((a, b) => b.userMsgs + b.metaSessions - (a.userMsgs + a.metaSessions)),
      months,
      matrix: this.matrix,
      engagedHours: this.slots.size / perHour,
      workShare: this.userMsgs ? this.workMsgs / this.userMsgs : 0,
      weekendDays,
      vendors: [...this.vendor.entries()]
        .map(([name, v]) => ({ name, ...v, sessions: vendorSessions.get(name) ?? 0 }))
        .sort((a, b) => b.replies - a.replies),
      models: [...this.model.entries()]
        .map(([name, m]) => ({ name, ...m }))
        .sort((a, b) => b.replies - a.replies)
        .slice(0, 12),
      projects: [...this.proj.entries()]
        .filter(([, p]) => p.userMsgs > 0)
        .map(([name, p]) => ({
          name,
          sessions: p.sessions.size,
          userMsgs: p.userMsgs,
          replies: p.replies,
          toolCalls: p.toolCalls,
          activeDays: p.days.size,
          firstTs: p.first,
          lastTs: p.last,
          sources: [...p.sources],
        }))
        .sort((a, b) => b.userMsgs - a.userMsgs)
        .slice(0, 15),
      unassignedMsgs: this.unassigned,
      sessions: human
        .filter((s) => s.userMsgs > 0)
        .sort((a, b) => b.userMsgs - a.userMsgs)
        .slice(0, 15)
        .map((s) => ({
          title: this.redact ? undefined : s.title,
          source: SOURCE_LABEL[s.source],
          project: s.project,
          start: s.first,
          end: s.last,
          userMsgs: s.userMsgs,
          replies: s.replies,
          toolCalls: s.toolCalls,
        })),
      automation: [...auto.values()].sort((a, b) => b.sessions - a.sessions),
    };
  }
}
