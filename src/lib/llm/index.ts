// LLM 适配器路由入口
// 根据服务商创建对应的适配器实例

import type { LLMAdapter, LLMProvider } from './types';
import { OpenAICompatibleAdapter } from './openai-adapter';

const adapterCache = new Map<string, LLMAdapter>();

export function getAdapter(provider: LLMProvider): LLMAdapter {
  const cacheKey = provider;
  if (adapterCache.has(cacheKey)) {
    return adapterCache.get(cacheKey)!;
  }

  // DeepSeek、通义千问、自定义 均兼容 OpenAI 格式
  const adapter = new OpenAICompatibleAdapter(provider as LLMProvider);
  adapterCache.set(cacheKey, adapter);
  return adapter;
}

export { OpenAICompatibleAdapter };
export * from './types';
