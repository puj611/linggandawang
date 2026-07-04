// src/stores/__tests__/llmAvailabilityStore.test.ts
// LLM 熔断器状态机单元测试
// 覆盖：unknown→available、available→degraded、熔断时长、半开探测、reset

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLLMAvailabilityStore } from '../llmAvailabilityStore';

describe('useLLMAvailabilityStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 每个用例前重置 store 状态
    useLLMAvailabilityStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态为 unknown，shouldAttempt 返回 true', () => {
    const state = useLLMAvailabilityStore.getState();
    expect(state.status).toBe('unknown');
    expect(state.shouldAttempt()).toBe(true);
    expect(state.consecutiveFailures).toEqual({});
    expect(state.degradeUntil).toBeNull();
  });

  it('recordSuccess 切换到 available 并清空失败计数', () => {
    useLLMAvailabilityStore.getState().recordFailure(new TypeError('Failed to fetch'));
    useLLMAvailabilityStore.getState().recordSuccess();

    const state = useLLMAvailabilityStore.getState();
    expect(state.status).toBe('available');
    expect(state.consecutiveFailures).toEqual({});
    expect(state.lastFailureAt).toBeNull();
    expect(state.degradeUntil).toBeNull();
    expect(state.shouldAttempt()).toBe(true);
  });

  it('auth 错误连续失败 1 次即熔断', () => {
    useLLMAvailabilityStore.getState().recordFailure(new Error('(401) Unauthorized'));

    const state = useLLMAvailabilityStore.getState();
    expect(state.status).toBe('degraded');
    expect(state.lastFailureKind).toBe('auth');
    expect(state.degradeUntil).not.toBeNull();
    expect(state.shouldAttempt()).toBe(false);
  });

  it('network 错误需连续失败 3 次才熔断', () => {
    const store = useLLMAvailabilityStore.getState();
    store.recordFailure(new TypeError('Failed to fetch'));
    expect(useLLMAvailabilityStore.getState().status).toBe('unknown');

    store.recordFailure(new TypeError('Failed to fetch'));
    expect(useLLMAvailabilityStore.getState().status).toBe('unknown');

    store.recordFailure(new TypeError('Failed to fetch'));
    expect(useLLMAvailabilityStore.getState().status).toBe('degraded');
    expect(useLLMAvailabilityStore.getState().lastFailureKind).toBe('network');
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(false);
  });

  it('timeout 错误需连续失败 2 次才熔断', () => {
    const store = useLLMAvailabilityStore.getState();
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';

    store.recordFailure(abortErr);
    expect(useLLMAvailabilityStore.getState().status).toBe('unknown');

    store.recordFailure(abortErr);
    expect(useLLMAvailabilityStore.getState().status).toBe('degraded');
    expect(useLLMAvailabilityStore.getState().lastFailureKind).toBe('timeout');
  });

  it('不同错误类型分别计数（network 2 次 + auth 1 次会熔断 auth）', () => {
    const store = useLLMAvailabilityStore.getState();
    store.recordFailure(new TypeError('Failed to fetch'));
    store.recordFailure(new TypeError('Failed to fetch'));
    // network 计数 2，未熔断
    expect(useLLMAvailabilityStore.getState().status).toBe('unknown');

    // auth 1 次失败，立即熔断（auth 阈值 1）
    store.recordFailure(new Error('(401)'));
    expect(useLLMAvailabilityStore.getState().status).toBe('degraded');
    expect(useLLMAvailabilityStore.getState().lastFailureKind).toBe('auth');
  });

  it('recordSuccess 重置后失败计数清零（network 失败 2 次后成功，再失败 1 次不熔断）', () => {
    const store = useLLMAvailabilityStore.getState();
    store.recordFailure(new TypeError('Failed to fetch'));
    store.recordFailure(new TypeError('Failed to fetch'));
    store.recordSuccess();
    store.recordFailure(new TypeError('Failed to fetch'));

    // recordSuccess 会把 status 设为 available，再失败 1 次不熔断（network 阈值 3）
    expect(useLLMAvailabilityStore.getState().status).toBe('available');
    expect(useLLMAvailabilityStore.getState().consecutiveFailures.network).toBe(1);
  });

  it('熔断时长：auth 30 分钟', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    const state = useLLMAvailabilityStore.getState();
    expect(state.degradeUntil).toBe(now + 30 * 60 * 1000);
  });

  it('熔断时长：network 2 分钟', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    const store = useLLMAvailabilityStore.getState();
    store.recordFailure(new TypeError('fetch'));
    store.recordFailure(new TypeError('fetch'));
    store.recordFailure(new TypeError('fetch'));

    const state = useLLMAvailabilityStore.getState();
    expect(state.degradeUntil).toBe(now + 2 * 60 * 1000);
  });

  it('熔断到期后 shouldAttempt 返回 true（半开探测）', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(false);

    // 推进 30 分钟 + 1 秒
    vi.setSystemTime(now + 30 * 60 * 1000 + 1000);
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(true);
  });

  it('熔断未到期 shouldAttempt 返回 false', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    vi.setSystemTime(now + 29 * 60 * 1000); // 还差 1 分钟
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(false);
  });

  it('半开探测成功后状态切回 available', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    vi.setSystemTime(now + 30 * 60 * 1000 + 1000);
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(true); // 半开

    useLLMAvailabilityStore.getState().recordSuccess();
    expect(useLLMAvailabilityStore.getState().status).toBe('available');
    expect(useLLMAvailabilityStore.getState().degradeUntil).toBeNull();
  });

  it('半开探测失败后重新熔断', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    vi.setSystemTime(now + 30 * 60 * 1000 + 1000);
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(true);

    // 半开探测又失败
    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    expect(useLLMAvailabilityStore.getState().status).toBe('degraded');
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(false);
  });

  it('reset 完全重置状态', () => {
    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    expect(useLLMAvailabilityStore.getState().status).toBe('degraded');

    useLLMAvailabilityStore.getState().reset();
    const state = useLLMAvailabilityStore.getState();
    expect(state.status).toBe('unknown');
    expect(state.consecutiveFailures).toEqual({});
    expect(state.degradeUntil).toBeNull();
    expect(state.lastFailureKind).toBeNull();
    expect(state.lastFriendlyMessage).toBeNull();
    expect(state.lastSuggestion).toBeNull();
  });

  it('getStatusMessage 在非 degraded 状态返回 null', () => {
    expect(useLLMAvailabilityStore.getState().getStatusMessage()).toBeNull();

    useLLMAvailabilityStore.getState().recordSuccess();
    expect(useLLMAvailabilityStore.getState().getStatusMessage()).toBeNull();
  });

  it('getStatusMessage 在 degraded 状态返回友好提示', () => {
    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    const msg = useLLMAvailabilityStore.getState().getStatusMessage();
    expect(msg).not.toBeNull();
    expect(msg!.level).toBe('warn');
    expect(msg!.text).toContain('API Key');
    expect(msg!.text).toContain('基础模式');
  });

  it('getStatusMessage 包含剩余时间提示', () => {
    const now = Date.now();
    vi.setSystemTime(now);

    useLLMAvailabilityStore.getState().recordFailure(new Error('(401)'));
    vi.setSystemTime(now + 5 * 60 * 1000); // 已过 5 分钟，剩余 25 分钟

    const msg = useLLMAvailabilityStore.getState().getStatusMessage();
    expect(msg).not.toBeNull();
    expect(msg!.text).toContain('25 分钟后');
  });

  it('bad_request 错误不触发熔断（阈值 Infinity）', () => {
    const store = useLLMAvailabilityStore.getState();
    store.recordFailure(new Error('(400) Bad Request'));
    store.recordFailure(new Error('(400) Bad Request'));
    store.recordFailure(new Error('(400) Bad Request'));

    // 即使失败 3 次，bad_request 阈值 Infinity，不熔断
    expect(useLLMAvailabilityStore.getState().status).toBe('unknown');
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(true);
  });

  it('unknown 错误不触发熔断', () => {
    const store = useLLMAvailabilityStore.getState();
    store.recordFailure(new Error('something weird'));
    store.recordFailure(new Error('something weird'));
    store.recordFailure(new Error('something weird'));

    expect(useLLMAvailabilityStore.getState().status).toBe('unknown');
    expect(useLLMAvailabilityStore.getState().shouldAttempt()).toBe(true);
  });

  it('lastFriendlyMessage 与 lastSuggestion 被正确记录', () => {
    useLLMAvailabilityStore.getState().recordFailure(new Error('(401) Unauthorized'));
    const state = useLLMAvailabilityStore.getState();
    expect(state.lastFriendlyMessage).toContain('API Key');
    expect(state.lastSuggestion).toBeDefined();
    expect(state.lastSuggestion!.length).toBeGreaterThan(0);
  });
});
