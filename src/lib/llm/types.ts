// LLM 适配器类型定义
// 统一所有 LLM 服务商的接口格式

/** LLM 服务商标识 */
export type LLMProvider = 'openai' | 'deepseek' | 'tongyi' | 'custom';

/** 聊天消息角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** 多模态内容：文本部分 */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/** 多模态内容：图片部分 */
export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string; // data:image/...;base64,... 或 https://...
    detail?: 'low' | 'high' | 'auto';
  };
}

/** 多模态内容联合类型 */
export type ContentPart = TextContentPart | ImageContentPart;

/** 聊天消息（支持纯文本或多模态内容） */
export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

/** LLM 请求参数 */
export interface LLMRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** 流式响应块 */
export interface LLMStreamChunk {
  delta: string;
  done: boolean;
}

/** LLM 适配器抽象接口 */
export interface LLMAdapter {
  /** 服务商标识 */
  provider: LLMProvider;

  /** 发送请求并获取完整响应
   *  @param signal 可选的外部取消信号，触发时 fetch 会被中止并抛出 AbortError
   *                调用方可用更短的超时来覆盖 adapter 内部的默认超时
   */
  chat(request: LLMRequest, apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<LLMResponse>;

  /** 发送流式请求
   *  @param signal 可选的外部取消信号
   */
  chatStream(
    request: LLMRequest,
    apiKey: string,
    baseUrl: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<LLMResponse>;

  /** 测试连接是否可用
   *  @param signal 可选的外部取消信号
   */
  testConnection(apiKey: string, baseUrl: string, signal?: AbortSignal): Promise<boolean>;
}

/** 服务商配置（非敏感信息，存储在 SQLite） */
export interface ProviderConfig {
  provider: LLMProvider;
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  description: string;
}

/** 预设服务商配置 */
export const PROVIDER_PRESETS: ProviderConfig[] = [
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: '性价比高，中文理解能力强',
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    description: '综合能力最强，成本较高',
  },
  {
    provider: 'tongyi',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    description: '阿里云出品，国内访问快',
  },
  {
    provider: 'custom',
    label: '自定义',
    baseUrl: '',
    defaultModel: '',
    models: [],
    description: '兼容 OpenAI 格式的任意 API',
  },
];

/** 已知支持视觉（多模态图片输入）的模型关键词列表 */
const VISION_MODEL_KEYWORDS = [
  'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
  'qwen-vl', 'qwen2-vl', 'qwen-multimodal',
  'claude-3', 'claude-sonnet', 'claude-opus', 'claude-haiku',
  'gemini', 'llava', 'internvl', 'yi-vl',
  'step-1v', 'step-1x', 'glm-4v',
];

/** 判断指定模型名是否支持视觉（图片）输入 */
export function isVisionModel(model: string): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  return VISION_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
}
