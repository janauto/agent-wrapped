// 竖屏翻页年报：单个 HTML 文件，数据和样式全部内联，不加载任何外部资源，可离线打开、截图分享。

import type { Stats } from "../stats/aggregate";
import { dateKey } from "../stats/aggregate";
import type { Persona } from "../stats/persona";

export interface SourceNote {
  label: string;
  detail: string;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => Math.round(n).toLocaleString("zh-CN");
const pad = (n: number) => String(n).padStart(2, "0");
const md = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
const hm = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dayText = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${m} 月 ${d} 日`;
};
const num = (n: number, cls = "") => `<b class="num ${cls}" data-n="${Math.round(n)}">${fmt(n)}</b>`;

function hourComment(h: number): string {
  if (h < 5) return "夜深人静，正是灵感和 bug 一起冒头的时候。";
  if (h < 9) return "别人还在通勤，你已经把需求丢给 AI 了。";
  if (h < 12) return "上午的脑子最清醒，你把它分给了 AI。";
  if (h < 14) return "午饭时间也没闲着。";
  if (h < 18) return "下午茶时间，是你和 AI 配合最默契的时候。";
  if (h < 22) return "下班不下线，晚上才是正经干活的时间。";
  return "临睡前再问一句，已经成了习惯。";
}

function bars(items: Array<{ label: string; value: number; note?: string }>, unit: string): string {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ul class="bars">${items
    .map(
      (i, k) => `<li style="--w:${(i.value / max) * 100}%;--k:${k}">
        <span class="bl">${esc(i.label)}</span><span class="bt"><i></i></span><span class="bv">${fmt(i.value)}${unit}</span>
        ${i.note ? `<small>${esc(i.note)}</small>` : ""}</li>`,
    )
    .join("")}</ul>`;
}

function hourChart(hours: number[], peak: number): string {
  const max = Math.max(1, ...hours);
  const W = 336,
    H = 120,
    bw = W / 24;
  const rects = hours
    .map((v, h) => {
      const bh = Math.max(2, (v / max) * (H - 18));
      return `<rect x="${h * bw + 1.5}" y="${H - 16 - bh}" width="${bw - 3}" height="${bh}" rx="2" class="${h === peak ? "pk" : ""}" style="--k:${h}"/>`;
    })
    .join("");
  const labels = [0, 6, 12, 18, 23].map((h) => `<text x="${h * bw + bw / 2}" y="${H - 2}">${h}</text>`).join("");
  return `<svg class="hours" viewBox="0 0 ${W} ${H}" role="img" aria-label="24 小时分布">${rects}${labels}</svg>`;
}

function heatmap(year: number, daily: Record<string, number>): string {
  const start = new Date(year, 0, 1);
  const offset = start.getDay();
  const days = Math.round((new Date(year + 1, 0, 1).getTime() - start.getTime()) / 86400000);
  const vals = Object.values(daily).sort((a, b) => a - b);
  const q = (p: number) => vals[Math.floor((vals.length - 1) * p)] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.8)];
  const level = (v: number) => (v <= 0 ? 0 : v <= cuts[0]! ? 1 : v <= cuts[1]! ? 2 : v <= cuts[2]! ? 3 : 4);
  const c = 6,
    g = 1.4;
  let cells = "";
  for (let i = 0; i < days; i++) {
    const d = new Date(year, 0, 1 + i);
    const idx = i + offset;
    const v = daily[dateKey(d.getTime())] ?? 0;
    cells += `<rect x="${Math.floor(idx / 7) * (c + g)}" y="${(idx % 7) * (c + g)}" width="${c}" height="${c}" rx="1.4" class="l${level(v)}"/>`;
  }
  const cols = Math.ceil((days + offset) / 7);
  return `<svg class="heat" viewBox="0 0 ${cols * (c + g)} ${7 * (c + g)}" role="img" aria-label="全年活跃热力图">${cells}</svg>`;
}

export function renderReport(s: Stats, p: Persona, notes: SourceNote[]): string {
  const pages: string[] = [];
  const page = (cls: string, body: string) => pages.push(`<section class="page ${cls}"><div class="in">${body}</div></section>`);
  const activeSources = s.sources.filter((x) => x.userMsgs + x.metaSessions > 0);

  page(
    "p-cover",
    `<p class="kicker">AGENT WRAPPED · ${s.year}</p>
     <h1>${s.year}<br>你和 AI 的<br>这一年</h1>
     <p class="sub">读取了这台电脑上 ${activeSources.length} 个 Agent 的记录<br>全程在本机完成</p>
     <p class="hint">向上滑动 ↑</p>`,
  );

  page(
    "p-total",
    `<p>这一年，你有</p><p class="big">${num(s.totals.activeDays)} <span>天</span></p><p>在和 AI 说话</p>
     <p class="gap">一共发出 ${num(s.totals.userMsgs, "hl")} 条消息，打了 ${num(s.totals.userChars, "hl")} 个字</p>
     <p class="soft">差不多是 ${fmt(Math.max(1, s.totals.userChars / 30000))} 本 3 万字的小书</p>
     <p class="gap">AI 回了你 ${num(s.totals.replies)} 次，替你调用了 ${num(s.totals.toolCalls)} 次工具</p>`,
  );

  if (s.firstMessage)
    page(
      "p-first",
      `<p class="kicker">年度第一句</p>
       <p class="big2">${md(s.firstMessage.ts)}<br>${hm(s.firstMessage.ts)}</p>
       <p>你在 <b>${esc(s.firstMessage.source)}</b> 敲下了今年的第一句</p>
       ${s.firstMessage.snippet ? `<blockquote>「${esc(s.firstMessage.snippet)}」</blockquote>` : ""}
       <p class="soft">一切从这里开始。</p>`,
    );

  if (activeSources.length)
    page(
      "p-agents",
      `<p class="kicker">你的 Agent 版图</p>
       <h2>最常找的是<br><em>${esc(activeSources[0]!.label)}</em></h2>
       ${bars(
         activeSources.map((x) => ({
           label: x.label,
           value: x.userMsgs || x.metaSessions,
           note:
             x.userMsgs === 0 && x.metaSessions
               ? `${x.metaSessions} 个会话，内容加密，导入官方导出包可看全`
               : `${fmt(x.sessions)} 个会话`,
         })),
         " 条",
       )}`,
    );

  if (s.vendors.length) {
    const ds = s.vendors.find((v) => v.name === "DeepSeek");
    page(
      "p-models",
      `<p class="kicker">模型阵容</p>
       <h2>回复你最多的是<br><em>${esc(s.vendors[0]!.name)}</em></h2>
       <div class="stack">${s.vendors
         .slice(0, 6)
         .map((v, k) => `<i style="--w:${v.share * 100}%;--k:${k}" title="${esc(v.name)}"></i>`)
         .join("")}</div>
       <ul class="legend">${s.vendors
         .slice(0, 6)
         .map((v, k) => `<li style="--k:${k}"><i></i>${esc(v.name)} <span>${Math.round(v.share * 100)}%</span></li>`)
         .join("")}</ul>
       <ol class="models">${s.models
         .slice(0, 5)
         .map((m) => `<li><span>${esc(m.name)}</span><span>${fmt(m.replies)} 次</span></li>`)
         .join("")}</ol>
       ${ds ? `<p class="soft">DeepSeek 陪你聊了 ${fmt(ds.replies)} 轮。</p>` : ""}`,
    );
  }

  page(
    "p-hours",
    `<p class="kicker">一天中的你</p>
     <h2>你最常在<br><em>${s.peakHour} 点</em>出现</h2>
     ${hourChart(s.hours, s.peakHour)}
     <p class="soft">${hourComment(s.peakHour)}</p>`,
  );

  if (s.latestNight) {
    const h = new Date(s.latestNight.ts).getHours();
    page(
      "p-night",
      `<p class="kicker">最晚的一夜</p>
       <p class="big2">${md(s.latestNight.ts)}<br>${h < 6 ? "凌晨 " : ""}${hm(s.latestNight.ts)}</p>
       <p>你还在 <b>${esc(s.latestNight.source)}</b> 里问</p>
       ${s.latestNight.snippet ? `<blockquote>「${esc(s.latestNight.snippet)}」</blockquote>` : ""}
       <p class="soft">${h < 6 ? "那天，你睡了吗？" : "这已经是你最晚的一次了，作息不错。"}</p>`,
    );
  }

  if (s.busiestDay)
    page(
      "p-busy",
      `<p class="kicker">最拼的一天</p>
       <p class="big2">${dayText(s.busiestDay.date)}</p>
       <p>这一天你发了 ${num(s.busiestDay.count, "hl")} 条消息</p>
       <p class="soft">大部分都给了 ${esc(s.busiestDay.topSource)}</p>`,
    );

  page(
    "p-heat",
    `<p class="kicker">全年足迹</p>
     <h2>最长连续<br><em>${s.streak.days} 天</em></h2>
     ${heatmap(s.year, s.daily)}
     ${s.streak.start ? `<p class="soft">${dayText(s.streak.start)} – ${dayText(s.streak.end!)}，一天都没断。</p>` : ""}`,
  );

  if (s.longestSession) {
    const m = s.longestSession.minutes;
    const dur = m >= 1440 ? `${Math.round(m / 1440)} 天` : m >= 60 ? `${Math.round(m / 60)} 小时` : `${m} 分钟`;
    page(
      "p-long",
      `<p class="kicker">聊得最久的一次</p>
       ${s.longestSession.title ? `<h2 class="title">${esc(s.longestSession.title)}</h2>` : ""}
       <p>${dayText(s.longestSession.date)} 开始，在 ${esc(s.longestSession.source)} 里</p>
       <p>你来回说了 ${num(s.longestSession.userMsgs, "hl")} 次，前后跨了 <b>${dur}</b></p>`,
    );
  }

  if (s.projects.length)
    page(
      "p-proj",
      `<p class="kicker">你最上心的项目</p>
       <h2><em>${esc(s.projects[0]!.name)}</em></h2>
       ${bars(
         s.projects.map((x) => ({ label: x.name, value: x.userMsgs })),
         " 条",
       )}`,
    );

  if (s.keywords.length) {
    const max = s.keywords[0]!.count;
    page(
      "p-words",
      `<p class="kicker">年度关键词</p>
       <div class="cloud">${s.keywords
         .map((k, i) => `<span style="--s:${0.8 + (k.count / max) * 1.5};--k:${i}">${esc(k.word)}</span>`)
         .join("")}</div>
       ${s.catchphrase ? `<p>你的口头禅是 <b class="hl">「${esc(s.catchphrase.text)}」</b></p><p class="soft">一共说了 ${fmt(s.catchphrase.count)} 次</p>` : ""}`,
    );
  }

  if (s.totals.automatedSessions)
    page(
      "p-auto",
      `<p class="kicker">你不在的时候</p>
       <p>还有 ${num(s.totals.automatedSessions, "hl")} 个会话是 AI 自己在跑</p>
       <p class="soft">定时任务、子代理、脚本……替你发出了 ${fmt(s.totals.automatedMsgs)} 条指令。<br>这些不算进上面的统计。</p>`,
    );

  page(
    "p-persona",
    `<p class="kicker">${s.year} 年度 AI 人设</p>
     <h1 class="persona">${esc(p.title)}</h1>
     <ul class="tags">${p.tags.map((t) => `<li><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></li>`).join("")}</ul>
     <p class="soft">明年见。</p>`,
  );

  page(
    "p-end",
    `<p class="kicker">数据从哪来</p>
     <ul class="notes">${notes.map((n) => `<li><b>${esc(n.label)}</b><span>${esc(n.detail)}</span></li>`).join("")}</ul>
     <p class="soft">所有统计都在这台电脑上完成，聊天记录没有上传到任何地方。<br>年报里只引用了几句原话，生成时加 --redact 可以全部隐藏。<br>生成于 ${new Date(s.generatedAt).toLocaleString("zh-CN")}</p>`,
  );

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${s.year} AI 年报</title>
<style>${CSS}</style></head>
<body><main>${pages.join("\n")}</main>
<nav class="dots">${pages.map((_, i) => `<i data-i="${i}"></i>`).join("")}</nav>
<script>${JS}</script></body></html>`;
}

const CSS = `
:root{--fg:#f7f3ff;--soft:rgba(247,243,255,.66);--hl:#ffe36e;--c0:#ff6b8b;--c1:#7c6cff;--c2:#33d1c6;--c3:#ffb547;--c4:#5aa9ff;--c5:#b07cff}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#0d0a1a}
body{color:var(--fg);font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
main{height:100svh;overflow-y:auto;scroll-snap-type:y mandatory;scrollbar-width:none}
main::-webkit-scrollbar{display:none}
.page{min-height:100svh;scroll-snap-align:start;display:flex;align-items:center;justify-content:center;padding:56px 24px;position:relative;overflow:hidden}
.in{width:100%;max-width:400px;display:flex;flex-direction:column;gap:14px;font-size:17px;line-height:1.6}
.in>*{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}
.page.on .in>*{opacity:1;transform:none}
${Array.from({ length: 10 }, (_, i) => `.page.on .in>*:nth-child(${i + 1}){transition-delay:${i * 0.12}s}`).join("")}
.kicker{font-size:13px;letter-spacing:.2em;color:var(--soft)}
h1{font-size:46px;line-height:1.15;font-weight:800}
h2{font-size:30px;line-height:1.3;font-weight:700}
h2.title{font-size:24px}
em{font-style:normal;color:var(--hl)}
.big{font-size:22px}.big .num{font-size:72px;line-height:1.1;color:var(--hl)}.big span{font-size:20px}
.big2{font-size:38px;font-weight:800;line-height:1.25}
.num{font-variant-numeric:tabular-nums}.hl{color:var(--hl)}
.sub,.soft{color:var(--soft);font-size:15px}
.gap{margin-top:10px}
.hint{margin-top:40px;color:var(--soft);font-size:13px;animation:bob 1.6s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-6px)}}
blockquote{font-size:20px;line-height:1.5;padding:14px 16px;border-left:3px solid var(--hl);background:rgba(255,255,255,.07);border-radius:0 12px 12px 0;word-break:break-all}
.bars{list-style:none;display:flex;flex-direction:column;gap:12px;margin-top:8px}
.bars li{display:grid;grid-template-columns:92px 1fr auto;align-items:center;gap:10px;font-size:14px}
.bars small{grid-column:2/4;color:var(--soft);font-size:12px;margin-top:-6px}
.bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt{height:12px;background:rgba(255,255,255,.1);border-radius:6px;overflow:hidden}
.bt i{display:block;height:100%;width:0;border-radius:6px;background:linear-gradient(90deg,var(--c1),var(--c0));transition:width 1.1s cubic-bezier(.2,.8,.2,1) calc(.3s + var(--k)*.1s)}
.page.on .bt i{width:var(--w)}
.bv{font-variant-numeric:tabular-nums;color:var(--soft)}
.stack{display:flex;height:20px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.08)}
.stack i{width:0;transition:width 1s ease calc(.3s + var(--k)*.12s)}
.page.on .stack i{width:var(--w)}
.stack i:nth-child(1),.legend li:nth-child(1) i{background:var(--c0)}.stack i:nth-child(2),.legend li:nth-child(2) i{background:var(--c1)}
.stack i:nth-child(3),.legend li:nth-child(3) i{background:var(--c2)}.stack i:nth-child(4),.legend li:nth-child(4) i{background:var(--c3)}
.stack i:nth-child(5),.legend li:nth-child(5) i{background:var(--c4)}.stack i:nth-child(6),.legend li:nth-child(6) i{background:var(--c5)}
.legend{list-style:none;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
.legend span{color:var(--soft)}
.models{list-style:none;counter-reset:m;font-size:14px;display:flex;flex-direction:column;gap:6px;margin-top:6px}
.models li{display:flex;justify-content:space-between;gap:12px;padding:8px 12px;background:rgba(255,255,255,.06);border-radius:10px}
.models li span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.models li span:last-child{color:var(--soft);flex:none}
svg.hours{width:100%;height:auto}
svg.hours rect{fill:rgba(255,255,255,.28);transform-box:fill-box;transform-origin:bottom;transform:scaleY(0);transition:transform .8s ease calc(.2s + var(--k)*.03s)}
.page.on svg.hours rect{transform:none}
svg.hours rect.pk{fill:var(--hl)}
svg.hours text{fill:var(--soft);font-size:10px;text-anchor:middle}
svg.heat{width:100%;height:auto}
.heat .l0{fill:rgba(255,255,255,.07)}.heat .l1{fill:#3d4f8f}.heat .l2{fill:#4f7fd0}.heat .l3{fill:#5fc0d8}.heat .l4{fill:var(--hl)}
.cloud{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline}
.cloud span{font-size:calc(var(--s)*15px);font-weight:700;line-height:1.3}
.cloud span:nth-child(5n+1){color:var(--hl)}.cloud span:nth-child(5n+2){color:#9fe8e0}.cloud span:nth-child(5n+3){color:#ffb0c2}.cloud span:nth-child(5n+4){color:#c6bcff}
.persona{font-size:44px;color:var(--hl)}
.tags,.notes{list-style:none;display:flex;flex-direction:column;gap:10px}
.tags li,.notes li{display:flex;flex-direction:column;padding:12px 14px;background:rgba(255,255,255,.08);border-radius:12px}
.tags b{font-size:18px}.tags span,.notes span{color:var(--soft);font-size:13px;word-break:break-all}
.notes b{font-size:15px}
.dots{position:fixed;right:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px}
.dots i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.3);transition:all .3s}
.dots i.on{background:var(--fg);height:14px;border-radius:3px}
.p-cover{background:radial-gradient(120% 80% at 20% 10%,#5b2bd6 0,transparent 60%),radial-gradient(100% 70% at 90% 90%,#e0457b 0,transparent 60%),#140c2e}
.p-total{background:linear-gradient(160deg,#1b1446,#3a1d6e 60%,#7a2a77)}
.p-first{background:linear-gradient(160deg,#0f2a3d,#14506a 55%,#1f8a8a)}
.p-agents{background:linear-gradient(160deg,#21103d,#4a1f7a 60%,#2c3fa8)}
.p-models{background:linear-gradient(160deg,#101935,#1c3570 55%,#3b2a85)}
.p-hours{background:linear-gradient(160deg,#2b1530,#6d2350 60%,#c2475a)}
.p-night{background:radial-gradient(90% 60% at 80% 15%,#3b3f9a 0,transparent 60%),linear-gradient(180deg,#05061a,#10123a)}
.p-busy{background:linear-gradient(160deg,#3a1408,#8a3412 55%,#d9732a)}
.p-heat{background:linear-gradient(160deg,#0b1c2c,#123e5a 60%,#1b6e7e)}
.p-long{background:linear-gradient(160deg,#1a1036,#3b2370 60%,#6b3fa8)}
.p-proj{background:linear-gradient(160deg,#0f2b22,#145542 60%,#2b8a5e)}
.p-words{background:linear-gradient(160deg,#1d0f33,#4a1b5e 55%,#8a2e6e)}
.p-auto{background:linear-gradient(160deg,#111827,#1f2b46 60%,#2f4a6e)}
.p-persona{background:radial-gradient(120% 80% at 50% 0%,#ff6b8b 0,transparent 55%),radial-gradient(100% 70% at 50% 100%,#7c6cff 0,transparent 60%),#1a0f2e}
.p-end{background:linear-gradient(180deg,#120d24,#0d0a1a)}
@media (min-width:700px){.in{max-width:420px}}
@media (prefers-reduced-motion:reduce){.in>*,.bt i,.stack i,svg.hours rect{transition:none!important}.hint{animation:none}}
`;

const JS = `
(()=>{const pages=[...document.querySelectorAll('.page')],dots=[...document.querySelectorAll('.dots i')];
const count=el=>{if(el.dataset.done)return;el.dataset.done=1;const n=+el.dataset.n,t0=performance.now(),d=1200;
const step=t=>{const p=Math.min(1,(t-t0)/d),v=Math.round(n*(1-Math.pow(1-p,3)));el.textContent=v.toLocaleString('zh-CN');if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)};
const main=document.querySelector('main');let cur=-1;
// 以屏幕中线落在哪一页为准，比按可见比例判断更稳（页面比屏幕高时也能点亮）
const sync=()=>{const mid=innerHeight/2;const i=pages.findIndex(p=>{const r=p.getBoundingClientRect();return r.top<=mid&&r.bottom>mid});
if(i<0||i===cur)return;cur=i;const p=pages[i];p.classList.add('on');p.querySelectorAll('.num').forEach(count);dots.forEach((d,k)=>d.classList.toggle('on',k===i))};
main.addEventListener('scroll',()=>requestAnimationFrame(sync),{passive:true});addEventListener('resize',sync);sync();
dots.forEach((d,i)=>d.addEventListener('click',()=>pages[i].scrollIntoView({behavior:'smooth'})));
document.addEventListener('keydown',e=>{const i=Math.max(cur,0);
if(['ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();pages[Math.min(i+1,pages.length-1)].scrollIntoView({behavior:'smooth'})}
if(['ArrowUp','PageUp'].includes(e.key)){e.preventDefault();pages[Math.max(i-1,0)].scrollIntoView({behavior:'smooth'})}})})();
`;
