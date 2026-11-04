// 统一数据模型：所有适配器都把各家聊天记录转换成 ChatEvent 流。
// 原文（text）只在内存里用于本地关键词统计，不会写入任何文件。

export type SourceId = "claude-code" | "chatgpt" | "hermes";

export type Role =
  | "user" // 本人发出的一条消息
  | "assistant" // 模型的一次回复
  | "tool" // 工具调用结果
  | "session"; // 只知道「这里有一个会话、最后活跃于何时」，没有内容（如 ChatGPT 加密缓存）

export interface ChatEvent {
  source: SourceId;
  /** 模型厂商，由模型名推断：Anthropic / OpenAI / DeepSeek / … */
  vendor: string;
  model?: string;
  sessionId: string;
  sessionTitle?: string;
  /** 所在项目（工作目录名），没有则为空 */
  project?: string;
  /** 渠道：hermes 的 weixin / desktop / cli / cron 等 */
  channel?: string;
  role: Role;
  /** 毫秒时间戳 */
  ts: number;
  /** 字数（字符数） */
  chars: number;
  /** 仅本人消息保留原文，供本地统计关键词；不落盘 */
  text?: string;
  /** 定时任务、子代理等非本人发起的消息 */
  automated?: boolean;
  /** 这条回复里发起的工具调用次数 */
  toolCalls?: number;
  /** 输出 token 数（拿得到才有） */
  outputTokens?: number;
}

export interface ScanOptions {
  /** 起止时间（毫秒，含 from 不含 to） */
  from: number;
  to: number;
}

export interface DetectResult {
  found: boolean;
  /** 给人看的一句话：在哪找到、有多少、为什么读不到 */
  detail: string;
}

export interface Adapter {
  id: SourceId;
  label: string;
  detect(): Promise<DetectResult>;
  scan(opts: ScanOptions): AsyncIterable<ChatEvent>;
}

export const SOURCE_LABEL: Record<SourceId, string> = {
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  hermes: "Hermes Agent",
};
