# agent-wrapped · AI Agent 年报

读取本机装过的各个 AI Agent 的聊天记录，生成一份像网易云 / 微信 / QQ 年报那样的个人使用轨迹：
这一年和 AI 聊了多少、几点最活跃、最晚一次是几点、最常用哪个 Agent 和模型、年度关键词、你的「AI 人设」……

一条命令扫描本机，生成两页本地 HTML：

- **年报** `out/wrapped-<年份>.html`：竖屏逐页滑动，适合截图分享。
- **使用图鉴** `out/atlas-<年份>.html`：给人力核查或主管查看的明细页，浅色表格、口径写清楚，可直接打印 / 导出 PDF。
  内容包括总览、数据来源与覆盖范围、月度趋势、一周 × 24 小时分布、模型与厂商、项目投入、重点会话、自动化任务、统计口径与局限。

```bash
bun install
bun run wrapped --year 2026                              # 扫描本机，生成 out/wrapped-2026.html
bun run wrapped --year 2026 --import ~/Downloads/chatgpt-export.zip   # 加上 ChatGPT 官方导出包
bun run wrapped --year 2026 --redact                     # 不显示任何原话和会话标题，适合公开分享
bun run wrapped --help
```

## 数据源

| Agent | 本机位置（macOS） | 读法 | 版本 |
|---|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | 流式读 JSONL；子代理、SDK 脚本、后台任务通知算「自动化」 | v0.1 |
| ChatGPT | 官方导出包（设置 → 数据控制 → 导出数据）里的 `conversations*.json` | 完整统计 | v0.1 |
| ChatGPT 桌面版 / Atlas | `~/Library/Application Support/com.openai.chat`、`com.openai.atlas` 下的 `conversations-v3-*/*.data` | 内容是加密的，密钥在只有 ChatGPT 自己能读的钥匙串分区，外部解不开；只读文件时间，记会话数与活跃时间 | v0.1 |
| DeepSeek | `~/.hermes/state.db`（Hermes Agent，经微信 / 桌面 / 命令行 / 定时任务） | 只读 SQLite；按会话模型名归厂商，定时任务、子代理算「自动化」 | v0.1 |
| 千问办公 | `~/Library/Application Support/QwenWorkCN/data/agents.db` | SQLite | v0.2 |
| Kimi | `~/Library/Application Support/kimi-desktop/`、`~/.kimi-work` | IndexedDB + JSON | v0.2 |
| 智谱 GLM | `~/.local/share/mimocode/mimocode.db` 等 harness | 按模型名 `glm*` 归类 | v0.2 |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | JSONL，计入 OpenAI 系 | v0.2 |

厂商按模型名归类（`src/vendor.ts`）：DeepSeek、GLM、MiMo 这类模型常跑在别家 harness 里，只能这样认。

注意：Claude Code 默认只保留最近一段时间的日志（`cleanupPeriodDays`），更早的记录本机已经没有了。

## 统计口径

- 「你」的数据只算本人发出的消息；定时任务、子代理、脚本发出的单独记为「自动化」，不混进年报主数据。
- 只知道时间、没有内容的会话（ChatGPT 本地缓存）计入活跃天数、时段分布和会话数，不计入消息数。
- 关键词用系统自带的 `Intl.Segmenter` 本地分词，先去掉代码、链接、路径；系统词典不认识的专业词靠单字二元组补。

## 隐私

- 全程离线：聊天记录只在内存里统计，不上传。
- 年报会引用几句原话（年度第一句、最晚一句）和最长会话的标题；图鉴不含原话，但列出重点会话和项目名称。加 `--redact` 隐藏全部原话和会话标题。
- 图鉴里的「AI 参与时长」按 15 分钟时段估算，不等于工时，交给人力前请看页面最后的「统计口径与局限」。
- 生成的年报在 `out/`，导入的导出包建议放 `imports/`，两者都在 `.gitignore` 里，不会进仓库。
- 仓库里的测试数据全部是手写的假数据。

## 开发

Bun + TypeScript，零运行时依赖。

```bash
bun test
bunx tsc --noEmit -p .
```

```
src/
  cli.ts              命令行入口
  model.ts            统一的 ChatEvent 结构与适配器接口
  vendor.ts           模型名 → 厂商
  adapters/           每个数据源一个适配器：detect() / scan()
  stats/              年报汇总（aggregate）、图鉴明细（detail）、关键词（keywords）、人设规则（persona）
  report/html.ts      竖屏翻页年报模板（单文件、无外部资源）
  report/atlas.ts     使用图鉴模板（浅色、表格、可打印）
```

版本与功能卡用合流（heliu）管理：`heliu -p agent-wrapped 待办 v0.1`。
