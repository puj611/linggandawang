// src/lib/llm/__tests__/withRetry.test.ts
// withRetry 指数退避重试逻辑单元测试
// 覆盖：成功路径、不可重试错误立即抛出、可重试错误重试、达到最大重试次数
// 注：用真实定时器 + mock setTimeout 立即执行，避免 fake timers 与 Promise.reject 的 unhandled rejection 冲突

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../withRetry';

describe('withRetry', () => {
  // 用 any 规避 vi.spyOn 重载类型不匹配问题（不影响运行时行为）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let setTimeoutSpy: any;

  beforeEach(() => {
    // mock setTimeout 让回调立即执行（同步），避免真实等待
    // 这样 sleep(1000) / sleep(3000) 会立即 resolve，不会卡住测试
    setTimeoutSpy = vi
      .spyOn(global, 'setTimeout' as any)
      .mockImplementation(((cb: TimerHandler) => {
        if (typeof cb === 'function') cb();
        return 0 as any;
      }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('成功路径不重试，直接返回结果', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('不可重试错误（auth/401）立即抛出，不重试', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('LLM 请求失败 (401): Unauthorized'));
    await expect(withRetry(fn)).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('不可重试错误（bad_request/400）立即抛出', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('LLM 请求失败 (400): Bad Request'));
    await expect(withRetry(fn)).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('可重试错误（network）触发重试，重试后成功', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('可重试错误（server 500）触发 2 次重试，间隔 1s + 3s', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('LLM 请求失败 (500)'))
      .mockRejectedValueOnce(new Error('LLM 请求失败 (500)'))
      .mockResolvedValueOnce('ok-after-2-retries');

    const result = await withRetry(fn, 2);
    expect(result).toBe('ok-after-2-retries');
    expect(fn).toHaveBeenCalledTimes(3); // 初次 + 2 次重试
  });

  it('达到最大重试次数仍失败，抛出最后一次错误', async () => {
    const err = new TypeError('Failed to fetch');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, 2)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 初次 + 2 次重试
  });

  it('timeout 错误可重试', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fn = vi
      .fn()
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rate_limit 错误可重试', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('(429) Too Many Requests'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn);
    expect(result).toBe('ok');
  });

  it('maxRetries=0 时不重试', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(withRetry(fn, 0)).rejects.toThrow('Failed to fetch');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('默认 maxRetries=2', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(withRetry(fn)).rejects.toThrow('Failed to fetch'); // 不传 maxRetries
    expect(fn).toHaveBeenCalledTimes(3); // 默认 2 次重试
  });

  it('不同错误类型不会混合计次（每次失败都重新分类）', async () => {
    // 第 1 次失败为 network（可重试），第 2 次失败为 auth（不可重试）
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new Error('(401) Unauthorized'));

    // 第 2 次失败为 auth，不可重试，立即抛出
    await expect(withRetry(fn)).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('返回值透传（包括对象/数组等引用类型）', async () => {
    const obj = { content: 'hello', model: 'gpt-4' };
    const fn = vi.fn().mockResolvedValue(obj);
    const result = await withRetry(fn);
    expect(result).toBe(obj); // 引用相同
  });

  it('退避间隔正确：第 1 次 1s，第 2 次 3s', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('ok');

    await withRetry(fn, 2);

    // 验证 setTimeout 被调用，间隔分别为 1000ms 和 3000ms
    const calls = setTimeoutSpy.mock.calls;
    const sleepCalls = calls.filter((c: number[]) => c[1] === 1000 || c[1] === 3000);
    expect(sleepCalls).toHaveLength(2);
    expect(sleepCalls[0][1]).toBe(1000);
    expect(sleepCalls[1][1]).toBe(3000);
  });
});
