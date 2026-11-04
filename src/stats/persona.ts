// 规则式人设标签：只看统计数字，不看原文。按命中强度排序，取前三。

import type { Stats } from "./aggregate";

export interface Tag {
  name: string;
  desc: string;
  score: number;
}

export interface Persona {
  title: string;
  tags: Tag[];
}

export function persona(s: Stats): Persona {
  const activity = s.hours.reduce((a, b) => a + b, 0) || 1;
  const night = (s.hours.slice(0, 5).reduce((a, b) => a + b, 0) + s.hours[23]!) / activity;
  const morning = s.hours.slice(5, 9).reduce((a, b) => a + b, 0) / activity;
  const weekend = (s.weekdays[0]! + s.weekdays[6]!) / (s.weekdays.reduce((a, b) => a + b, 0) || 1);
  const avgChars = s.totals.userMsgs ? s.totals.userChars / s.totals.userMsgs : 0;
  const toolsPerReply = s.totals.replies ? s.totals.toolCalls / s.totals.replies : 0;
  const tools = s.sources.filter((x) => x.userMsgs + x.metaSessions > 0).length;
  const vendors = s.vendors.filter((v) => v.share >= 0.02).length;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  const tags: Tag[] = [];
  const add = (hit: boolean, name: string, desc: string, score: number) => hit && tags.push({ name, desc, score });

  add(night >= 0.12, "深夜写码人", `${pct(night)} 的消息发生在 23 点到凌晨 5 点`, night * 3);
  add(morning >= 0.15, "早起的鸟", `${pct(morning)} 的消息发生在早上 5–9 点`, morning * 3);
  add(weekend >= 0.3, "周末战士", `${pct(weekend)} 的消息发生在周末`, weekend * 2);
  add(tools >= 3 || vendors >= 3, "多 Agent 指挥官", `同时在用 ${tools} 个 Agent、${vendors} 家模型`, 0.5 + tools * 0.1 + vendors * 0.1);
  add(s.streak.days >= 30, "全勤打卡王", `连续 ${s.streak.days} 天和 AI 说话`, Math.min(s.streak.days / 60, 1.5));
  add(toolsPerReply >= 1, "放手让 AI 干活", `每次回复平均调用 ${toolsPerReply.toFixed(1)} 次工具`, Math.min(toolsPerReply / 2, 1.2));
  add(avgChars >= 150, "长文需求官", `平均每条消息 ${Math.round(avgChars)} 字`, Math.min(avgChars / 300, 1.2));
  add(avgChars > 0 && avgChars <= 25, "惜字如金", `平均每条消息只有 ${Math.round(avgChars)} 字`, 0.8);
  add(/^(继续|接着|go on|continue)/i.test(s.catchphrase?.text ?? ""), "「继续」侠", `说了 ${s.catchphrase?.count} 次「${s.catchphrase?.text}」`, 0.9);

  tags.sort((a, b) => b.score - a.score);
  const picked = tags.slice(0, 3);
  return { title: picked[0]?.name ?? "AI 新朋友", tags: picked };
}
