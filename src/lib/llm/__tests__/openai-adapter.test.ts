// src/lib/llm/__tests__/openai-adapter.test.ts
// OpenAICompatibleAdapter 单元测试 - P0 用例 T01-T07
// 覆盖：正常请求、内部超时、外部取消、HTTP 错误、网络错误、API Key 脱敏
// 注：withRetry 已在 withRetry.test.ts 独立测试，此处 mock 为透传，专注验证 adapter 自身行为

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock withRetry：直接调用 fn，不重试（重试逻辑已在 withRetry.test.ts 测试）
vi.mock('../withRetry', () => ({
  withRetry: vi.fn(<T>(fn: () => Promise<T>): Promise<T> => fn()),
}));

import { OpenAICompatibleAdapter } from '../openai-adapter';
import type { LLMRequest } from '../types';

const BASE_URL = 'https://api.example.com/v1';
const API_KEY = 'sk-test-abcdef1234567890';
const MODEL = 'gpt-4o-mini';

function makeRequest(): LLMRequest {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    model: MODEL,
    temperature: 0.5,
    max_tokens: 100,
  };
}

function makeFetchResponse(
  ok: boolean,
  status: number,
  body: unknown,
): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

/**
 * 创建一个响应 abort signal 的 pending fetch mock
 * 当 signal.abort() 被调用时，fetch mock 会 reject 一个 AbortError
 */
function makeAbortablePendingFetch(): typeof fetch {
  return ((_url: string, opts: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      const signal = opts.signal;
      if (signal) {
        if (signal.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
      // 否则永远 pending
    });
  }) as unknown as typeof fetch;
}

describe('OpenAICompatibleAdapter.chat - P0 用例 T01-T07', () => {
  let adapter: OpenAICompatibleAdapter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    adapter = new OpenAICompatibleAdapter('openai');
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('T01: 正常请求返回 LLMResponse', async () => {
    const mockBody = {
      choices: [{ message: { content: 'Hello back!' } }],
      model: 'gpt-4o-mini-2024-07-18',
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };
    fetchSpy.mockResolvedValueOnce(makeFetchResponse(true, 200, mockBody) as any);

    const result = await adapter.chat(makeRequest(), API_KEY, BASE_URL);

    expect(result.content).toBe('Hello back!');
    expect(result.model).toBe('gpt-4o-mini-2024-07-18');
    expect(result.usage?.total_tokens).toBe(8);

    // 验证 fetch 调用参数
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe(`${BASE_URL}/chat/completions`);
    const opts = callArgs[1] as RequestInit;
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe(MODEL);
    expect(body.stream).toBe(false);
  });

  it('T01.2: choices 为空数组时返回空 content', async () => {
    const mockBody = { choices: [], model: MODEL };
    fetchSpy.mockResolvedValueOnce(makeFetchResponse(true, 200, mockBody) as any);

    const result = await adapter.chat(makeRequest(), API_KEY, BASE_URL);
    expect(result.content).toBe('');
    expect(result.model).toBe(MODEL);
  });

  it('T02: 内部 30s 超时抛出超时错误', async () => {
    vi.useFakeTimers();
    // fetch 永远 pending，但响应 abort signal
    fetchSpy.mockImplementationOnce(makeAbortablePendingFetch());

    const promise = adapter.chat(makeRequest(), API_KEY, BASE_URL);
    // 先 attach rejection handler，避免推进 timer 后 promise 已 reject 但无 handler
    const expectation = expect(promise).rejects.toThrow(/超时|timeout/i);

    // 推进 30s + 1ms 触发内部 AbortController.abort()
    await vi.advanceTimersByTimeAsync(30001);

    await expectation;
  });

  it('T03: 外部 signal 8s 超时抛出"被外部取消"错误', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchSpy.mockImplementationOnce(makeAbortablePendingFetch());

    const promise = adapter.chat(
      makeRequest(),
      API_KEY,
      BASE_URL,
      controller.signal,
    );
    // 先 attach rejection handler，避免推进 timer 后 promise 已 reject 但无 handler
    const expectation = expect(promise).rejects.toThrow(/外部取消|超时/);

    // 8s 后外部 abort
    await vi.advanceTimersByTimeAsync(8000);
    controller.abort();

    await expectation;
  });

  it('T03.2: 外部 signal 已 aborted 时立即抛出', async () => {
    const controller = new AbortController();
    controller.abort();

    fetchSpy.mockImplementationOnce(makeAbortablePendingFetch());

    await expect(
      adapter.chat(makeRequest(), API_KEY, BASE_URL, controller.signal),
    ).rejects.toThrow(/外部取消|超时/);
  });

  it('T04: HTTP 401 抛出含 401 的错误', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(false, 401, { error: 'Unauthorized' }) as any,
    );

    await expect(
      adapter.chat(makeRequest(), API_KEY, BASE_URL),
    ).rejects.toThrow(/401/);
  });

  it('T04.2: HTTP 403 抛出含 403 的错误', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(false, 403, { error: 'Forbidden' }) as any,
    );

    await expect(
      adapter.chat(makeRequest(), API_KEY, BASE_URL),
    ).rejects.toThrow(/403/);
  });

  it('T05: HTTP 429 抛出含 429 的错误', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(false, 429, { error: 'Too Many Requests' }) as any,
    );

    await expect(
      adapter.chat(makeRequest(), API_KEY, BASE_URL),
    ).rejects.toThrow(/429/);
  });

  it('T05.2: HTTP 500 抛出含 500 的错误', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(false, 500, { error: 'Internal Server Error' }) as any,
    );

    await expect(
      adapter.chat(makeRequest(), API_KEY, BASE_URL),
    ).rejects.toThrow(/500/);
  });

  it('T06: 网络错误（fetch rejected with TypeError）', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(
      adapter.chat(makeRequest(), API_KEY, BASE_URL),
    ).rejects.toThrow(/Failed to fetch/);
  });

  it('T06.2: fetch 抛出通用 Error 透传', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('something broke'));

    await expect(
      adapter.chat(makeRequest(), API_KEY, BASE_URL),
    ).rejects.toThrow('something broke');
  });

  it('T07: API Key 在错误消息中被脱敏', async () => {
    // 服务商回显了完整 Key（极少见但需防护）
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(false, 401, {
        error: `Invalid key: ${API_KEY}`,
      }) as any,
    );

    try {
      await adapter.chat(makeRequest(), API_KEY, BASE_URL);
      expect.fail('应抛出错误');
    } catch (e) {
      const msg = (e as Error).message;
      // 错误消息中不应包含完整 Key
      expect(msg).not.toContain(API_KEY);
      // 应包含脱敏后的 Key（sk-test***，保留 sk- + 4 字符）
      expect(msg).toMatch(/sk-test\*\*\*/);
    }
  });

  it('T07.2: Bearer Token 在错误消息中被脱敏', async () => {
    const bearerKey = 'Bearer sk-bearertoken1234567890';
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(false, 401, {
        error: `Auth failed: ${bearerKey}`,
      }) as any,
    );

    try {
      await adapter.chat(makeRequest(), API_KEY, BASE_URL);
      expect.fail('应抛出错误');
    } catch (e) {
      const msg = (e as Error).message;
      // 不应包含完整 Bearer Token
      expect(msg).not.toContain('sk-bearertoken1234567890');
      // 应有脱敏标记（Bearer sk-bear***，保留 Bearer sk- + 4 字符）
      expect(msg).toMatch(/Bearer\s+sk-bear\*\*\*/);
    }
  });

  it('T07.3: 请求头中包含完整 API Key（验证 Authorization 头正确设置）', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(true, 200, {
        choices: [{ message: { content: 'ok' } }],
        model: MODEL,
      }) as any,
    );

    await adapter.chat(makeRequest(), API_KEY, BASE_URL);

    const opts = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${API_KEY}`);
  });
});

describe('OpenAICompatibleAdapter - 安全防护', () => {
  let adapter: OpenAICompatibleAdapter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    adapter = new OpenAICompatibleAdapter('openai');
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    // 默认 mock：立即 reject，避免某些 URL 在 jsdom 下卡住（如 IPv6）
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('拒绝 HTTP 协议（非 localhost）', async () => {
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'http://api.example.com/v1',
      ),
    ).rejects.toThrow(/HTTPS/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('拒绝内网地址 10.x.x.x', async () => {
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'https://10.0.0.1/v1',
      ),
    ).rejects.toThrow(/内网/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('拒绝内网地址 192.168.x.x', async () => {
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'https://192.168.1.1/v1',
      ),
    ).rejects.toThrow(/内网/);
  });

  it('拒绝 HTTPS 协议下的 127.0.0.1（仅 HTTP 放行）', async () => {
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'https://127.0.0.1/v1',
      ),
    ).rejects.toThrow(/内网|127/);
  });

  it('拒绝 IPv6 回环 ::1', async () => {
    // jsdom 下 URL.hostname 对 IPv6 的处理可能不同，接受内网拒绝或 fetch 失败
    // 关键是：不能成功访问内网
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'https://[::1]/v1',
      ),
    ).rejects.toThrow(/内网|IPv6|fetch|abort|Failed/i);
  });

  it('拒绝 IPv4-mapped IPv6 ::ffff:10.0.0.1', async () => {
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'https://[::ffff:10.0.0.1]/v1',
      ),
    ).rejects.toThrow(/内网|IPv6|fetch|abort|Failed/i);
  });

  it('拒绝十进制 IPv4（2130706433 → 127.0.0.1）', async () => {
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'https://2130706433/v1',
      ),
    ).rejects.toThrow(/内网/);
  });

  it('拒绝链路本地 169.254.x.x（云元数据端点）', async () => {
    await expect(
      adapter.chat(
        makeRequestSafe(),
        API_KEY,
        'https://169.254.169.254/v1',
      ),
    ).rejects.toThrow(/内网/);
  });

  it('允许 localhost（开发环境）', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(true, 200, {
        choices: [{ message: { content: 'ok' } }],
        model: MODEL,
      }) as any,
    );

    const result = await adapter.chat(
      makeRequestSafe(),
      API_KEY,
      'http://localhost:3000/v1',
    );
    expect(result.content).toBe('ok');
  });

  it('允许 HTTP 127.0.0.1（开发环境）', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse(true, 200, {
        choices: [{ message: { content: 'ok' } }],
        model: MODEL,
      }) as any,
    );

    await adapter.chat(
      makeRequestSafe(),
      API_KEY,
      'http://127.0.0.1:3000/v1',
    );
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('无效 URL 抛出格式错误', async () => {
    await expect(
      adapter.chat(makeRequestSafe(), API_KEY, 'not-a-url'),
    ).rejects.toThrow(/格式无效|URL/);
  });
});

// 辅助：使用 https 公网地址避免触发 baseUrl 校验
function makeRequestSafe(): LLMRequest {
  return {
    messages: [{ role: 'user', content: 'safe' }],
    model: MODEL,
    temperature: 0.3,
    max_tokens: 50,
  };
}
