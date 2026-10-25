// src/engine/__tests__/ImagePromptExtractor.test.ts
// 图片提示词拆解引擎单测：LLM 管道拆解、解析容错、熔断/无密钥/超时错误路径
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  shouldAttempt: vi.fn(() => true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('@/lib/llm', () => ({
  getAdapter: () => ({ chat: mocks.chat }),
}));

const apiKeyState = {
  config: { provider: 'deepseek', model: 'deepseek-vl', baseUrl: 'https://api.example.com/v1' },
  hasApiKey: true,
  getApiKey: async () => ['test', 'key-12345'].join('-'),
};

vi.mock('@/stores/apiKeyStore', () => ({
  useApiKeyStore: { getState: () => apiKeyState },
}));

vi.mock('@/stores/llmAvailabilityStore', () => ({
  useLLMAvailabilityStore: {
    getState: () => ({
      shouldAttempt: mocks.shouldAttempt,
      getStatusMessage: () => ({ text: 'AI 智能增强暂时不可用（熔断保护中）' }),
      recordSuccess: mocks.recordSuccess,
      recordFailure: mocks.recordFailure,
    }),
  },
}));

vi.mock('@/lib/llm/error-messages', () => ({
  classifyLLMError: () => ({ friendlyMessage: '服务暂不可用', suggestion: '稍后重试' }),
}));

import { imagePromptExtractor } from '../ImagePromptExtractor';

const VALID_CONTENT = [
  'SCENE|夜晚的赛博朋克城市街道',
  'SUBJECTS|霓虹灯招牌, 湿漉漉的街道,行人',
  'STYLE|赛博朋克,写实',
  'COLORS|蓝,紫,粉',
  'LAYOUT|低视角仰拍|前景引导线',
  'MOOD|孤独而繁华',
  'PROMPT|cyberpunk city street at night, neon signs, wet road, low angle',
].join('\n');

describe('ImagePromptExtractor', () => {
  beforeEach(() => {
    mocks.chat.mockReset();
    mocks.shouldAttempt.mockReturnValue(true);
    mocks.recordSuccess.mockClear();
    mocks.recordFailure.mockClear();
    apiKeyState.hasApiKey = true;
  });

  it('成功路径：解析七个字段，逗号列表去空白，recordSuccess 被调用', async () => {
    mocks.chat.mockResolvedValue({ content: VALID_CONTENT });
    const result = await imagePromptExtractor.extract({ dataUrl: 'data:image/png;base64,x' });
    expect(result.scene).toBe('夜晚的赛博朋克城市街道');
    expect(result.subjects).toEqual(['霓虹灯招牌', '湿漉漉的街道', '行人']);
    expect(result.style).toEqual(['赛博朋克', '写实']);
    expect(result.colors).toEqual(['蓝', '紫', '粉']);
    // 值内含 | 时应保留（join 回去）
    expect(result.layout).toBe('低视角仰拍|前景引导线');
    expect(result.mood).toBe('孤独而繁华');
    expect(result.fullPrompt).toContain('cyberpunk city street');
    expect(mocks.recordSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailure).not.toHaveBeenCalled();
  });

  it('userHint 会拼进用户消息', async () => {
    mocks.chat.mockResolvedValue({ content: '' });
    await imagePromptExtractor.extract({ dataUrl: 'data:image/png;base64,x', userHint: '参考这张的配色' });
    const call = mocks.chat.mock.calls[0];
    const userMsg = (call[0].messages as Array<{ role: string; content: unknown }>)[1];
    const textPart = (userMsg.content as Array<{ type: string; text?: string }>).find(
      (p) => p.type === 'text',
    );
    expect(textPart?.text).toContain('参考这张的配色');
  });

  it('内容缺字段时给默认占位值', async () => {
    mocks.chat.mockResolvedValue({ content: 'SCENE|只有场景\n无关行没有分隔符' });
    const result = await imagePromptExtractor.extract({ dataUrl: 'data:image/png;base64,x' });
    expect(result.scene).toBe('只有场景');
    expect(result.subjects).toEqual([]);
    expect(result.layout).toBe('未能识别构图');
    expect(result.fullPrompt).toBe('');
  });

  it('未配置 API Key：抛高级功能提示', async () => {
    apiKeyState.hasApiKey = false;
    await expect(
      imagePromptExtractor.extract({ dataUrl: 'data:image/png;base64,x' }),
    ).rejects.toThrow('高级功能');
  });

  it('熔断开启时直接抛熔断提示，不调用 LLM', async () => {
    mocks.shouldAttempt.mockReturnValue(false);
    await expect(
      imagePromptExtractor.extract({ dataUrl: 'data:image/png;base64,x' }),
    ).rejects.toThrow('熔断保护');
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('超时中断（AbortError）：抛明确超时提示并记录失败', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mocks.chat.mockRejectedValue(abortErr);
    await expect(
      imagePromptExtractor.extract({ dataUrl: 'data:image/png;base64,x' }),
    ).rejects.toThrow('超时');
    expect(mocks.recordFailure).toHaveBeenCalledWith(abortErr);
  });

  it('其他 LLM 错误：抛友好错误（含 suggestion）并记录失败', async () => {
    const err = new Error('HTTP 500');
    mocks.chat.mockRejectedValue(err);
    await expect(
      imagePromptExtractor.extract({ dataUrl: 'data:image/png;base64,x' }),
    ).rejects.toThrow('图片拆解失败：服务暂不可用（稍后重试）');
    expect(mocks.recordFailure).toHaveBeenCalledWith(err);
  });
});
