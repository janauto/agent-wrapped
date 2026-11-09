#!/usr/bin/env bun
// agent-wrapped：扫描本机各 AI Agent 的聊天记录，生成竖屏翻页年报 HTML。

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chatgptAdapter } from "./adapters/chatgpt";
import { claudeCodeAdapter } from "./adapters/claude-code";
import { hermesAdapter } from "./adapters/hermes";
import type { Adapter, SourceId } from "./model";
import { Aggregator } from "./stats/aggregate";
import { DetailAggregator } from "./stats/detail";
import { renderAtlas } from "./report/atlas";
import { persona } from "./stats/persona";
import { renderReport, type SourceNote } from "./report/html";

const HELP = `用法：bun run wrapped [选项]

  --year <年份>        统计哪一年（默认今年）
  --import <路径>      ChatGPT 官方导出包（zip / 解压后的目录 / conversations.json），可重复
  --sources <列表>     只读这些来源，逗号分隔：claude-code,chatgpt,hermes（默认全部）
  --out <目录>         输出目录（默认 out/）
  --redact            不在年报里显示任何原话片段和会话标题（适合公开分享）
  --json              同时输出统计数据 stats-<年份>.json
  -h, --help          显示帮助

每次生成两页：wrapped-<年份>.html（竖屏年报）和 atlas-<年份>.html（给人力 / 主管看的使用图鉴，可打印）`;

const { values } = parseArgs({
  options: {
    year: { type: "string" },
    import: { type: "string", multiple: true },
    sources: { type: "string" },
    out: { type: "string" },
    redact: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const year = Number(values.year ?? new Date().getFullYear());
if (!Number.isInteger(year) || year < 2000 || year > 2100) {
  console.error(`年份不对：${values.year}`);
  process.exit(1);
}
const from = new Date(year, 0, 1).getTime();
const to = new Date(year + 1, 0, 1).getTime();
const imports = (values.import ?? []).map((p) => resolve(p));

const all: Adapter[] = [claudeCodeAdapter(), chatgptAdapter(imports), hermesAdapter()];
const wanted = values.sources ? new Set(values.sources.split(",").map((s) => s.trim() as SourceId)) : undefined;
const adapters = wanted ? all.filter((a) => wanted.has(a.id)) : all;

console.log(`agent-wrapped · 统计 ${year} 年\n`);
const agg = new Aggregator(year, Boolean(values.redact));
const detail = new DetailAggregator(year, Boolean(values.redact));
const notes: SourceNote[] = [];

for (const a of adapters) {
  const det = await a.detect();
  if (!det.found) {
    console.log(`  ✗ ${a.label}：${det.detail}`);
    notes.push({ label: a.label, detail: `没读到：${det.detail}` });
    continue;
  }
  const t0 = performance.now();
  let n = 0;
  try {
    for await (const ev of a.scan({ from, to })) {
      agg.add(ev);
      detail.add(ev);
      n++;
    }
  } catch (e) {
    console.log(`  ! ${a.label} 读取中断：${(e as Error).message}`);
  }
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ ${a.label}：${det.detail} → ${year} 年 ${n.toLocaleString()} 条记录（${sec}s）`);
  notes.push({ label: a.label, detail: det.detail.replaceAll(process.env.HOME ?? "\0", "~") });
}

const stats = agg.finish();
const p = persona(stats);
const outDir = resolve(values.out ?? "out");
await mkdir(outDir, { recursive: true });
const htmlPath = join(outDir, `wrapped-${year}.html`);
await Bun.write(htmlPath, renderReport(stats, p, notes));
const d = detail.finish();
const atlasPath = join(outDir, `atlas-${year}.html`);
const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
const command = ["bun run wrapped", ...process.argv.slice(2)].join(" ").replaceAll(process.env.HOME ?? "\0", "~");
await Bun.write(atlasPath, renderAtlas(d, notes, { version: pkg.version, command, redacted: Boolean(values.redact) }));
if (values.json)
  await Bun.write(join(outDir, `stats-${year}.json`), JSON.stringify({ ...stats, persona: p, detail: d }, null, 2));

const t = stats.totals;
console.log(`
${year} 年：活跃 ${t.activeDays} 天 · 你发出 ${t.userMsgs.toLocaleString()} 条 · AI 回复 ${t.replies.toLocaleString()} 次 · ${t.sessions.toLocaleString()} 个会话
厂商：${stats.vendors.map((v) => `${v.name} ${Math.round(v.share * 100)}%`).join("、") || "无"}
人设：${p.title}${p.tags.length > 1 ? `（${p.tags.slice(1).map((x) => x.name).join("、")}）` : ""}
自动化：${t.automatedSessions} 个会话、${t.automatedMsgs} 条指令（不计入上面）

年报：${htmlPath}
图鉴：${atlasPath}`);
