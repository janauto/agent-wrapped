// Agent 使用图鉴：给人力核查或主管查看的明细页。
// 和年报的区别：浅色、表格为主、数字可核对、口径写清楚、能直接打印成 A4 / 导出 PDF。
// 单文件，不加载任何外部资源。

import type { Detail } from "../stats/detail";
import { SLOT_MINUTES } from "../stats/detail";
import type { SourceNote } from "./html";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const n = (x: number) => Math.round(x).toLocaleString("zh-CN");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pad = (x: number) => String(x).padStart(2, "0");
const ymd = (ts?: number) => {
  if (ts === undefined) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const ymdhm = (ts: number) => {
  const d = new Date(ts);
  return `${ymd(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const tokens = (x: number) => (x >= 1e8 ? `${(x / 1e8).toFixed(2)} 亿` : x >= 1e4 ? `${(x / 1e4).toFixed(1)} 万` : n(x));
const hours = (x: number) => (x >= 10 ? n(x) : x.toFixed(1));
const duration = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 1440 ? `${(m / 1440).toFixed(1)} 天` : m >= 60 ? `${(m / 60).toFixed(1)} 小时` : `${m} 分钟`;
};

function table(head: string[], rows: string[][], numCols: number[] = [], foot?: string[]): string {
  const cls = (i: number) => (numCols.includes(i) ? ' class="r"' : "");
  return `<div class="tw"><table>
  <thead><tr>${head.map((h, i) => `<th${cls(i)}>${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${c}</td>`).join("")}</tr>`).join("")}</tbody>
  ${foot ? `<tfoot><tr>${foot.map((c, i) => `<td${cls(i)}>${c}</td>`).join("")}</tr></tfoot>` : ""}
</table></div>`;
}

/** 表格里的横向小条，帮助一眼看出量级 */
const bar = (v: number, max: number, label: string) =>
  `<span class="cb"><i style="width:${max ? (v / max) * 100 : 0}%"></i></span><span class="cv">${label}</span>`;

function heatmap(matrix: number[][]): string {
  const days = ["一", "二", "三", "四", "五", "六", "日"];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const max = Math.max(1, ...matrix.flat());
  const c = 22,
    g = 3,
    left = 26,
    top = 18;
  let svg = "";
  for (let h = 0; h < 24; h += 3) svg += `<text x="${left + h * (c + g) + c / 2}" y="12" class="ax">${h}</text>`;
  order.forEach((wd, row) => {
    const y = top + row * (c + g);
    svg += `<text x="${left - 8}" y="${y + c / 2 + 4}" class="ax ay">${days[row]}</text>`;
    for (let h = 0; h < 24; h++) {
      const v = matrix[wd]![h]!;
      const a = v ? 0.12 + 0.88 * Math.sqrt(v / max) : 0;
      const work = row < 5 && h >= 9 && h < 18;
      svg += `<rect x="${left + h * (c + g)}" y="${y}" width="${c}" height="${c}" rx="3" class="${work ? "wk" : ""}" style="fill-opacity:${v ? a.toFixed(3) : 1}" ${v ? "" : 'data-z="1"'}><title>周${days[row]} ${h}:00–${h + 1}:00　${v} 条</title></rect>`;
    }
  });
  const W = left + 24 * (c + g),
    H = top + 7 * (c + g);
  return `<svg class="mx" viewBox="0 0 ${W} ${H}" role="img" aria-label="一周 × 24 小时消息分布">${svg}</svg>`;
}

export interface AtlasMeta {
  version: string;
  command: string;
  redacted: boolean;
}

export function renderAtlas(d: Detail, notes: SourceNote[], meta: AtlasMeta): string {
  const tot = d.coverage.reduce(
    (a, c) => ({
      sessions: a.sessions + c.sessions,
      userMsgs: a.userMsgs + c.userMsgs,
      replies: a.replies + c.replies,
      toolCalls: a.toolCalls + c.toolCalls,
      outputTokens: a.outputTokens + c.outputTokens,
      autoS: a.autoS + c.automatedSessions,
      autoM: a.autoM + c.automatedMsgs,
    }),
    { sessions: 0, userMsgs: 0, replies: 0, toolCalls: 0, outputTokens: 0, autoS: 0, autoM: 0 },
  );
  const activeDays = d.months.reduce((a, m) => a + m.activeDays, 0);
  const firstTs = Math.min(...d.coverage.map((c) => c.firstTs ?? Infinity));
  const lastTs = Math.max(...d.coverage.map((c) => c.lastTs ?? -Infinity));
  const hasData = Number.isFinite(firstTs);

  const kpis: Array<[string, string, string]> = [
    ["活跃天数", n(activeDays), hasData ? `${ymd(firstTs)} 至 ${ymd(lastTs)}` : "无记录"],
    ["会话数", n(tot.sessions), "本人参与的会话"],
    ["本人消息", n(tot.userMsgs), "亲自输入的指令 / 提问"],
    ["AI 回复", n(tot.replies), `平均每条消息 ${tot.userMsgs ? (tot.replies / tot.userMsgs).toFixed(1) : "0"} 次回复`],
    ["工具调用", n(tot.toolCalls), "读写文件、执行命令、检索等"],
    ["输出 Token", tokens(tot.outputTokens), "只统计能拿到用量的来源"],
    ["AI 参与时长", `约 ${hours(d.engagedHours)} 小时`, `按 ${SLOT_MINUTES} 分钟时段累计`],
    ["工作时段占比", pct(d.workShare), "工作日 9:00–18:00 的消息占比"],
  ];

  const maxMonth = Math.max(0, ...d.months.map((m) => m.userMsgs));
  const maxProj = Math.max(0, ...d.projects.map((p) => p.userMsgs));
  const vendorTotal = d.vendors.reduce((a, v) => a + v.replies, 0) || 1;
  const metaNote = d.coverage.some((c) => c.metaSessions)
    ? `<p class="note">含 ${n(d.coverage.reduce((a, c) => a + c.metaSessions, 0))} 个只能读到时间的会话（内容加密，未计入消息数）。</p>`
    : "";

  const sections: string[] = [];
  const sec = (id: string, title: string, lead: string, body: string) =>
    sections.push(`<section id="${id}"><h2>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ""}${body}</section>`);

  sec(
    "kpi",
    "一、总览",
    "",
    `<div class="kpis">${kpis.map(([k, v, s]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join("")}</div>`,
  );

  sec(
    "sources",
    "二、数据来源与覆盖范围",
    "每个来源实际读到的时间范围。早于「最早记录」的使用情况本机已不存在，不代表没有使用。",
    table(
      ["来源", "最早记录", "最近记录", "活跃天数", "会话", "本人消息", "AI 回复", "工具调用", "输出 Token"],
      d.coverage.map((c) => [
        `<b>${esc(c.label)}</b>`,
        ymd(c.firstTs),
        ymd(c.lastTs),
        n(c.activeDays),
        n(c.sessions),
        n(c.userMsgs),
        n(c.replies),
        n(c.toolCalls),
        c.outputTokens ? tokens(c.outputTokens) : "—",
      ]),
      [3, 4, 5, 6, 7, 8],
      ["合计", hasData ? ymd(firstTs) : "—", hasData ? ymd(lastTs) : "—", n(activeDays), n(tot.sessions), n(tot.userMsgs), n(tot.replies), n(tot.toolCalls), tokens(tot.outputTokens)],
    ) +
      metaNote +
      `<ul class="src">${notes.map((x) => `<li><b>${esc(x.label)}</b>　${esc(x.detail)}</li>`).join("")}</ul>`,
  );

  sec(
    "months",
    "三、月度趋势",
    "按自然月统计。会话按开始时间归月；AI 参与时长按有本人消息或 AI 回复的时段累计。",
    table(
      ["月份", "活跃天数", "新会话", "本人消息", "AI 回复", "工具调用", "AI 参与时长"],
      d.months.map((m) => [
        m.month,
        n(m.activeDays),
        n(m.sessions),
        bar(m.userMsgs, maxMonth, n(m.userMsgs)),
        n(m.replies),
        n(m.toolCalls),
        m.hours ? `${hours(m.hours)} 小时` : "—",
      ]),
      [1, 2, 4, 5, 6],
    ),
  );

  sec(
    "time",
    "四、时间分布",
    `颜色越深消息越多；描边格为工作日 9:00–18:00。全年 ${n(activeDays)} 个活跃日中有 ${n(d.weekendDays)} 天是周末，本人消息 ${pct(d.workShare)} 落在工作时段。`,
    heatmap(d.matrix),
  );

  sec(
    "models",
    "五、模型与厂商",
    "厂商按模型名归类（同一个 Agent 可能接多家模型）。会话数指该厂商至少回复过一次的会话。",
    `<div class="two">${table(
      ["厂商", "回复", "占比", "会话", "输出 Token"],
      d.vendors.map((v) => [esc(v.name), n(v.replies), pct(v.replies / vendorTotal), n(v.sessions), v.outputTokens ? tokens(v.outputTokens) : "—"]),
      [1, 2, 3, 4],
    )}${table(
      ["模型", "厂商", "回复", "输出 Token"],
      d.models.map((m) => [`<code>${esc(m.name)}</code>`, esc(m.vendor), n(m.replies), m.outputTokens ? tokens(m.outputTokens) : "—"]),
      [2, 3],
    )}</div>`,
  );

  sec(
    "projects",
    "六、项目投入",
    `按会话的工作目录归到项目，展示本人消息最多的 ${d.projects.length} 个。${d.unassignedMsgs ? `另有 ${n(d.unassignedMsgs)} 条消息没有项目归属（如微信、网页对话、主目录下的会话）。` : ""}`,
    d.projects.length
      ? table(
          ["项目", "使用工具", "首次", "最近", "活跃天数", "会话", "本人消息", "工具调用"],
          d.projects.map((p) => [
            `<b>${esc(p.name)}</b>`,
            esc(p.sources.join("、")),
            ymd(p.firstTs),
            ymd(p.lastTs),
            n(p.activeDays),
            n(p.sessions),
            bar(p.userMsgs, maxProj, n(p.userMsgs)),
            n(p.toolCalls),
          ]),
          [4, 5, 7],
        )
      : `<p class="note">没有可归属到项目的会话。</p>`,
  );

  sec(
    "sessions",
    "七、重点会话",
    `本人消息最多的 ${d.sessions.length} 个会话。${meta.redacted ? "已按 --redact 隐藏会话标题。" : "标题取自各工具自动或手动生成的会话名。"}`,
    table(
      ["会话", "来源", "项目", "开始", "跨度", "本人消息", "AI 回复", "工具调用"],
      d.sessions.map((s) => [
        s.title ? esc(s.title) : `<span class="mute">（${meta.redacted ? "已隐藏" : "无标题"}）</span>`,
        esc(s.source),
        esc(s.project ?? "—"),
        ymdhm(s.start),
        duration(s.end - s.start),
        n(s.userMsgs),
        n(s.replies),
        n(s.toolCalls),
      ]),
      [5, 6, 7],
    ),
  );

  sec(
    "auto",
    "八、自动化任务",
    `不是本人当场输入的指令：定时任务、子代理、脚本调用等，共 ${n(tot.autoM)} 条，以上各节均未计入。其中 ${n(tot.autoS)} 个会话全程无人参与；其余是本人会话里由子代理发出的。`,
    d.automation.length
      ? table(
          ["来源", "渠道 / 类型", "全自动会话", "自动指令"],
          d.automation.map((a) => [esc(a.source), esc(a.channel), n(a.sessions), n(a.msgs)]),
          [2, 3],
        )
      : `<p class="note">没有自动化任务。</p>`,
  );

  sec(
    "method",
    "九、统计口径与局限",
    "",
    `<dl class="defs">
      <dt>本人消息</dt><dd>本人在对话框里输入的消息，含斜杠命令。不含工具返回结果、系统注入内容、后台任务通知。</dd>
      <dt>AI 回复</dt><dd>模型的一次完整回复。同一回复被日志拆成多行时合并为一次。</dd>
      <dt>会话</dt><dd>各工具自己的会话单位（Claude Code 的一个对话、ChatGPT 的一个对话、Hermes 的一个会话）。</dd>
      <dt>活跃天数</dt><dd>有本人消息，或有只能读到时间的会话的自然日。</dd>
      <dt>AI 参与时长</dt><dd>把时间切成 ${SLOT_MINUTES} 分钟一格，有本人消息或 AI 回复的格子计入，累加得出。是估算值，不等于工时：AI 自主执行长任务时人可能在做别的事，人思考、阅读的时间也可能没有落在消息上。</dd>
      <dt>自动化</dt><dd>子代理、SDK 脚本、定时任务、协调者转发等非本人当场输入的消息，单独统计，不计入本人数据。</dd>
      <dt>局限</dt><dd>只统计本机现存的记录：Claude Code 会定期清理旧日志；ChatGPT 本地缓存是加密的，只能读到会话时间，完整内容需导入官方导出包；网页版、手机端、其他电脑上的使用不在统计范围内。</dd>
      <dt>隐私</dt><dd>统计在本机完成，聊天内容没有上传。本页不含消息原文${meta.redacted ? "，会话标题已隐藏" : "，仅列出会话标题；生成时加 --redact 可隐藏"}。</dd>
    </dl>`,
  );

  const generated = new Date();
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent 使用图鉴 ${d.year}</title>
<style>${CSS}</style></head>
<body>
<header class="top">
  <div>
    <p class="eyebrow">AGENT 使用图鉴</p>
    <h1>${d.year} 年 AI Agent 使用情况</h1>
    <p class="period">统计周期 ${ymd(d.from)} 至 ${ymd(d.to - 1)}　·　生成于 ${ymdhm(generated.getTime())}</p>
  </div>
  <button class="print" onclick="print()">打印 / 导出 PDF</button>
</header>
<nav class="toc">${[
    ["kpi", "总览"],
    ["sources", "数据来源"],
    ["months", "月度趋势"],
    ["time", "时间分布"],
    ["models", "模型与厂商"],
    ["projects", "项目投入"],
    ["sessions", "重点会话"],
    ["auto", "自动化"],
    ["method", "统计口径"],
  ]
    .map(([id, t]) => `<a href="#${id}">${t}</a>`)
    .join("")}</nav>
<main>${sections.join("\n")}</main>
<footer>由 agent-wrapped ${esc(meta.version)} 生成　·　<code>${esc(meta.command)}</code>　·　<a href="wrapped-${d.year}.html">查看年报版 →</a></footer>
</body></html>`;
}

const CSS = `
:root{--fg:#1d2330;--mute:#677086;--line:#e3e6ee;--bg:#f6f7fa;--card:#fff;--ac:#3d5afe;--ac2:#e8ecff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.top{max-width:1080px;margin:0 auto;padding:40px 24px 16px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.eyebrow{font-size:12px;letter-spacing:.18em;color:var(--ac);font-weight:600}
h1{font-size:28px;line-height:1.3;margin-top:4px}
.period{color:var(--mute);margin-top:6px}
.print{border:1px solid var(--line);background:var(--card);color:var(--fg);padding:8px 14px;border-radius:8px;font:inherit;cursor:pointer}
.print:hover{border-color:var(--ac);color:var(--ac)}
.toc{position:sticky;top:0;z-index:2;background:rgba(246,247,250,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.toc{display:flex;gap:4px;overflow-x:auto;padding:8px max(24px,calc((100% - 1080px)/2 + 24px));scrollbar-width:none}
.toc a{flex:none;color:var(--mute);text-decoration:none;padding:4px 10px;border-radius:6px;font-size:13px}
.toc a:hover{background:var(--ac2);color:var(--ac)}
main{max-width:1080px;margin:0 auto;padding:8px 24px 24px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px 24px;margin-top:16px;scroll-margin-top:56px}
h2{font-size:17px;margin-bottom:6px}
.lead{color:var(--mute);margin-bottom:14px;font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:8px}
.kpi{border:1px solid var(--line);border-radius:10px;padding:14px}
.kpi .k{color:var(--mute);font-size:12px}
.kpi .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0}
.kpi .s{color:var(--mute);font-size:12px}
.tw{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:12px;color:var(--mute);font-weight:600;background:#fafbfd}
td:first-child{white-space:normal;min-width:120px}
.r{text-align:right}
tfoot td{font-weight:700;border-top:2px solid var(--line);border-bottom:none}
tbody tr:hover{background:#fafbff}
.cb{display:inline-block;width:90px;height:8px;background:var(--ac2);border-radius:4px;vertical-align:middle;margin-right:8px;overflow:hidden}
.cb i{display:block;height:100%;background:var(--ac);border-radius:4px}
.cv{display:inline-block;min-width:48px;text-align:right}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f3f8;padding:1px 5px;border-radius:4px}
.note{color:var(--mute);font-size:13px;margin-top:10px}
.mute{color:var(--mute)}
.src{list-style:none;margin-top:12px;color:var(--mute);font-size:12px;display:flex;flex-direction:column;gap:3px}
.src b{color:var(--fg);font-weight:600}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
svg.mx{width:100%;max-width:640px;height:auto;display:block}
svg.mx rect{fill:var(--ac)}
svg.mx rect[data-z]{fill:#eef0f5}
svg.mx rect.wk{stroke:#9aa7d6;stroke-width:1}
svg.mx .ax{font-size:10px;fill:var(--mute);text-anchor:middle}
svg.mx .ay{text-anchor:end}
.defs{display:grid;grid-template-columns:110px 1fr;gap:8px 16px}
.defs dt{font-weight:600}
.defs dd{color:#3c4458}
footer{max-width:1080px;margin:0 auto;padding:8px 24px 40px;color:var(--mute);font-size:12px}
footer a{color:var(--ac)}
@media (max-width:760px){.kpis{grid-template-columns:repeat(2,1fr)}.kpi .v{font-size:20px}.two{grid-template-columns:1fr}.defs{grid-template-columns:1fr}.defs dd{margin-bottom:6px}section{padding:18px 16px}.top{padding:28px 16px 12px}main{padding:8px 16px 20px}h1{font-size:22px}}
@media print{
  @page{size:A4;margin:14mm 12mm}
  body{background:#fff;font-size:11px}
  .toc,.print{display:none}
  .top{padding:0 0 8px}
  main,footer{padding:0;max-width:none}
  section{border:none;border-top:1px solid var(--line);border-radius:0;padding:12px 0;margin:0;break-inside:avoid}
  #sessions,#projects,#months,#models{break-inside:auto}
  .two{grid-template-columns:1fr}
  tr{break-inside:avoid}
  th,td{padding:4px 6px}
  .kpis{grid-template-columns:repeat(4,1fr)}
  .tw{overflow:visible}
  td:first-child{min-width:0}
}
`;
