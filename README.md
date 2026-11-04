# agent-wrapped · AI Agent 年报

读取本机装过的各个 AI Agent 的聊天记录，生成一份像网易云 / 微信 / QQ 年报那样的个人使用轨迹：
这一年和 AI 聊了多少、几点最活跃、最晚一次是几点、最常用哪个 Agent 和模型、年度关键词、你的「AI 人设」……

一条命令扫描本机 → 生成一个本地 HTML，竖屏逐页滑动，适合截图分享。

```bash
bun run wrapped --year 2026          # 纯本地统计
bun run wrapped --year 2026 --llm    # 额外把统计摘要（不含原文）发给大模型写文案
```

## 数据源

| Agent | 本机位置（macOS） | 格式 | 版本 |
|---|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | JSONL | v0.1 |
| ChatGPT 桌面版 | `~/Library/Application Support/com.openai.chat/conversations-v3-*/*.data` | 加密缓存（钥匙串密钥本地解密，系统弹窗确认）；官方导出包 `conversations.json` 兜底 | v0.1 |
| DeepSeek | 跑在编码 harness（opencode / Claude Code / Codex 等）里 | 按会话模型名 `deepseek*` 归类 | v0.1 |
| 千问办公 | `~/Library/Application Support/QwenWorkCN/data/agents.db` | SQLite | v0.2 |
| Kimi | `~/Library/Application Support/kimi-desktop/`、`~/.kimi-work` | IndexedDB + JSON | v0.2 |
| 智谱 GLM | 跑在编码 harness 里 | 按模型名 `glm*` 归类 | v0.2 |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | JSONL，计入 OpenAI 系 | v0.2 |

## 隐私

- 默认全程离线：聊天原文只在内存里统计，不落盘、不上传。
- `--llm` 只发送统计结果（数字、标签、关键词），不发送任何对话原文；模型、地址、密钥只从环境变量读取。
- 生成的年报在 `out/`，导入的导出包放 `imports/`，两者都在 `.gitignore` 里，不会进仓库。
- 读取 ChatGPT 缓存密钥需要你在 macOS 钥匙串弹窗里点「允许」，程序不保存密钥。

## 开发

Bun + TypeScript，零服务端依赖。版本与功能卡用合流（heliu）管理：`heliu 待办 v0.1`。
