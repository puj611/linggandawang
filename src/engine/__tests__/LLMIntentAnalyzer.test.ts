// src/engine/__tests__/LLMIntentAnalyzer.test.ts
// LLMIntentAnalyzer 单元测试 - P0 用例 T08-T09
// 覆盖：未配置 LLM 降级、熔断中降级、超时降级、成功路径
// 注：normalizeAnalysis 的归一化测试已在 normalize.test.ts 覆盖

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 外部依赖
const mockGetAdapter = vi.fn();
const mockBuildIntentAnalysisMessages = vi.fn();
const mockApiKeyState = {
  config: null as null | { provider: 'openai'; baseUrl: string; model: string },
  hasApiKey: false,
  getApiKey: vi.fn(),
};
const mockLLMAvailabilityState = {
  shouldAttempt: vi.fn(() => true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
};

vi.mock('@/lib/llm', () => ({
  getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
}));
vi.mock('@/stores/apiKeyStore', () => ({
  useApiKeyStore: { getState: () => mockApiKeyState },
}));
vi.mock('@/stores/llmAvailabilityStore', () => ({
  useLLMAvailabilityStore: { getState: () => mockLLMAvailabilityState },
}));
vi.mock('../prompts/intent-analysis', () => ({
  buildIntentAnalysisMessages: (...args: unknown[]) =>
    mockBuildIntentAnalysisMessages(...args),
}));

import { analyzeIntent } from '../LLMIntentAnalyzer';

describe('analyzeIntent - P0 用例 T08-T09 降级测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置默认 mock 状态
    mockApiKeyState.config = null;
    mockApiKeyState.hasApiKey = false;
    mockApiKeyState.getApiKey.mockReset();
    mockLLMAvailabilityState.shouldAttempt.mockReturnValue(true);
    mockLLMAvailabilityState.recordSuccess.mockReset();
    mockLLMAvailabilityState.recordFailure.mockReset();
    mockBuildIntentAnalysisMessages.mockReturnValue([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T08: 未配置 LLM（config=null）返回 null 降级', async () => {
    mockApiKeyState.config = null;
    mockApiKeyState.hasApiKey = false;

    const result = await analyzeIntent('我想做一个登录页面');

    expect(result).toBeNull();
    expect(mockGetAdapter).not.toHaveBeenCalled();
    expect(mockLLMAvailabilityState.shouldAttempt).not.toHaveBeenCalled();
  });

  it('T08.2: 已配置但 hasApiKey=false 返回 null', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = false;

    const result = await analyzeIntent('test');

    expect(result).toBeNull();
    expect(mockGetAdapter).not.toHaveBeenCalled();
  });

  it('T08.3: getApiKey 返回 null 返回 null', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue(null);

    const result = await analyzeIntent('test');

    expect(result).toBeNull();
    expect(mockGetAdapter).not.toHaveBeenCalled();
  });

  it('T08.4: 熔断中（shouldAttempt=false）直接返回 null，不调用 adapter', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');
    mockLLMAvailabilityState.shouldAttempt.mockReturnValue(false);

    const result = await analyzeIntent('test');

    expect(result).toBeNull();
    // 熔断中应跳过 adapter 调用，避免 8s 超时
    expect(mockGetAdapter).not.toHaveBeenCalled();
    // 不应调用 recordFailure（因为根本没尝试）
    expect(mockLLMAvailabilityState.recordFailure).not.toHaveBeenCalled();
  });

  it('T09: adapter.chat 抛出 AbortError（超时）降级到 null 并记录失败', async () => {
    vi.useFakeTimers();
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const mockChat = vi.fn().mockRejectedValue(abortErr);
    mockGetAdapter.mockReturnValue({ chat: mockChat });

    const promise = analyzeIntent('test');
    // 8s 超时触发
    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;

    expect(result).toBeNull();
    // 应调用 recordFailure 记录失败
    expect(mockLLMAvailabilityState.recordFailure).toHaveBeenCalledTimes(1);
    expect(mockLLMAvailabilityState.recordSuccess).not.toHaveBeenCalled();
  });

  it('T09.2: adapter.chat 抛出 401 错误降级到 null', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');

    const mockChat = vi
      .fn()
      .mockRejectedValue(new Error('LLM 请求失败 (401): Unauthorized'));
    mockGetAdapter.mockReturnValue({ chat: mockChat });

    const result = await analyzeIntent('test');

    expect(result).toBeNull();
    expect(mockLLMAvailabilityState.recordFailure).toHaveBeenCalledTimes(1);
    expect(mockLLMAvailabilityState.recordSuccess).not.toHaveBeenCalled();
  });

  it('T09.3: adapter.chat 抛出网络错误降级到 null', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');

    const mockChat = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    mockGetAdapter.mockReturnValue({ chat: mockChat });

    const result = await analyzeIntent('test');

    expect(result).toBeNull();
    expect(mockLLMAvailabilityState.recordFailure).toHaveBeenCalledTimes(1);
  });

  it('T09.4: adapter.chat 返回无效 JSON 降级到 null', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');

    const mockChat = vi.fn().mockResolvedValue({
      content: 'not a json',
      model: 'gpt-4o-mini',
    });
    mockGetAdapter.mockReturnValue({ chat: mockChat });

    const result = await analyzeIntent('test');

    // 解析失败应返回 null（而非抛错）
    expect(result).toBeNull();
    // 但因 chat 调用本身成功了，应记录 success
    expect(mockLLMAvailabilityState.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it('成功路径：返回解析后的 LLMIntentAnalysis', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');

    const llmJson = JSON.stringify({
      scene: 'frontend-ui',
      pain_points: [{ text: '慢', dimension: '性能', severity: 4 }],
      detected_dimensions: [{ tag: 'perf', weight: 0.7, confidence: 0.8 }],
      urgency: 'high',
      ambiguity_score: 0.3,
      suggested_followup: '继续追问',
      followup_options: ['A', 'B'],
    });
    const mockChat = vi.fn().mockResolvedValue({
      content: llmJson,
      model: 'gpt-4o-mini',
    });
    mockGetAdapter.mockReturnValue({ chat: mockChat });

    const result = await analyzeIntent('我的页面很慢');

    expect(result).not.toBeNull();
    expect(result!.scene).toBe('frontend-ui');
    expect(result!.pain_points).toHaveLength(1);
    expect(result!.urgency).toBe('high');
    expect(result!.source).toBe('llm');
    expect(mockLLMAvailabilityState.recordSuccess).toHaveBeenCalledTimes(1);
    expect(mockLLMAvailabilityState.recordFailure).not.toHaveBeenCalled();
  });

  it('成功路径：传入 recentQA 给 buildIntentAnalysisMessages', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');

    const mockChat = vi.fn().mockResolvedValue({
      content: '{}',
      model: 'gpt-4o-mini',
    });
    mockGetAdapter.mockReturnValue({ chat: mockChat });
    mockBuildIntentAnalysisMessages.mockReturnValue([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);

    const recentQA = [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ];

    await analyzeIntent('test', 'react', recentQA);

    expect(mockBuildIntentAnalysisMessages).toHaveBeenCalledWith(
      'test',
      'react',
      recentQA,
    );
  });

  it('成功路径：不传 recentQA 时 buildIntentAnalysisMessages 收到 undefined', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test');

    const mockChat = vi.fn().mockResolvedValue({
      content: '{}',
      model: 'gpt-4o-mini',
    });
    mockGetAdapter.mockReturnValue({ chat: mockChat });

    await analyzeIntent('test');

    expect(mockBuildIntentAnalysisMessages).toHaveBeenCalledWith(
      'test',
      undefined,
      undefined,
    );
  });

  it('chat 请求参数正确传递（temperature=0.3, max_tokens=800）', async () => {
    mockApiKeyState.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    };
    mockApiKeyState.hasApiKey = true;
    mockApiKeyState.getApiKey.mockResolvedValue('sk-test-key');

    const mockChat = vi.fn().mockResolvedValue({
      content: '{}',
      model: 'gpt-4o-mini',
    });
    mockGetAdapter.mockReturnValue({ chat: mockChat });

    await analyzeIntent('test');

    expect(mockChat).toHaveBeenCalledTimes(1);
    const callArgs = mockChat.mock.calls[0];
    expect(callArgs[0].temperature).toBe(0.3);
    expect(callArgs[0].max_tokens).toBe(800);
    expect(callArgs[0].model).toBe('gpt-4o-mini');
    expect(callArgs[1]).toBe('sk-test-key'); // apiKey
    expect(callArgs[2]).toBe('https://api.openai.com/v1'); // baseUrl
  });
});
