// 由模型名推断厂商。DeepSeek、GLM 等常跑在别家 harness 里，只能靠模型名归类。

const RULES: Array<[RegExp, string]> = [
  [/deepseek/i, "DeepSeek"],
  [/^(glm|chatglm|zhipu)/i, "智谱 GLM"],
  [/(qwen|qwq|tongyi)/i, "通义千问"],
  [/(kimi|moonshot)/i, "Kimi"],
  [/mimo/i, "小米 MiMo"],
  [/gemini/i, "Google"],
  [/(claude|opus|sonnet|haiku|fable)/i, "Anthropic"],
  [/(^gpt|^o\d|chatgpt|codex|^text-davinci|^dall-e|research)/i, "OpenAI"],
];

export function vendorOf(model: string | undefined, fallback = "未知"): string {
  if (!model) return fallback;
  for (const [re, name] of RULES) if (re.test(model)) return name;
  return fallback;
}
