// src/lib/llm/__tests__/error-messages.test.ts
// 错误分类单元测试：classifyLLMError / getCircuitBreakerDuration / getFailureThreshold
// 覆盖 7 种错误类型 + 边界场景

import { describe, it, expect } from 'vitest';
import {
  classifyLLMError,
  getCircuitBreakerDuration,
  getFailureThreshold,
} from '../error-messages';

describe('classifyLLMError', () => {
  it('401 错误识别为 auth', () => {
    const r = classifyLLMError(new Error('LLM 请求失败 (401): Unauthorized'));
    expect(r.kind).toBe('auth');
    expect(r.retryable).toBe(false);
    expect(r.friendlyMessage).toContain('API Key');
  });

  it('403 错误识别为 auth', () => {
    const r = classifyLLMError(new Error('LLM 请求失败 (403): Forbidden'));
    expect(r.kind).toBe('auth');
    expect(r.retryable).toBe(false);
  });

  it('401 状态码无括号也能识别', () => {
    const r = classifyLLMError(new Error('HTTP 401 Unauthorized'));
    expect(r.kind).toBe('auth');
  });

  it('429 错误识别为 rate_limit', () => {
    const r = classifyLLMError(new Error('LLM 请求失败 (429): Too Many Requests'));
    expect(r.kind).toBe('rate_limit');
    expect(r.retryable).toBe(true);
    expect(r.friendlyMessage).toContain('频繁');
  });

  it('500 错误识别为 server', () => {
    const r = classifyLLMError(new Error('LLM 请求失败 (500): Internal Server Error'));
    expect(r.kind).toBe('server');
    expect(r.retryable).toBe(true);
  });

  it('502/503/504 错误识别为 server', () => {
    expect(classifyLLMError(new Error('(502)')).kind).toBe('server');
    expect(classifyLLMError(new Error('(503)')).kind).toBe('server');
    expect(classifyLLMError(new Error('(504)')).kind).toBe('server');
  });

  it('400 错误识别为 bad_request', () => {
    const r = classifyLLMError(new Error('LLM 请求失败 (400): Bad Request'));
    expect(r.kind).toBe('bad_request');
    expect(r.retryable).toBe(false);
  });

  it('AbortError 识别为 timeout', () => {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    const r = classifyLLMError(e);
    expect(r.kind).toBe('timeout');
    expect(r.retryable).toBe(true);
  });

  it('错误消息含"超时"识别为 timeout', () => {
    const r = classifyLLMError(new Error('LLM 请求超时（30秒）'));
    expect(r.kind).toBe('timeout');
  });

  it('错误消息含"timeout"识别为 timeout', () => {
    const r = classifyLLMError(new Error('Request timeout'));
    expect(r.kind).toBe('timeout');
  });

  it('TypeError 识别为 network', () => {
    const r = classifyLLMError(new TypeError('Failed to fetch'));
    expect(r.kind).toBe('network');
    expect(r.retryable).toBe(true);
    expect(r.friendlyMessage).toContain('网络');
  });

  it('错误消息含 "failed to fetch" 识别为 network', () => {
    const r = classifyLLMError(new Error('failed to fetch'));
    expect(r.kind).toBe('network');
  });

  it('错误消息含 ECONNREFUSED 识别为 network', () => {
    const r = classifyLLMError(new Error('connect ECONNREFUSED 127.0.0.1:443'));
    expect(r.kind).toBe('network');
  });

  it('错误消息含 DNS 识别为 network', () => {
    const r = classifyLLMError(new Error('getaddrinfo ENOTFOUND api.example.com dns'));
    expect(r.kind).toBe('network');
  });

  it('其他错误识别为 unknown', () => {
    const r = classifyLLMError(new Error('Something weird happened'));
    expect(r.kind).toBe('unknown');
    expect(r.retryable).toBe(false);
  });

  it('非 Error 输入安全处理', () => {
    expect(classifyLLMError('just a string').kind).toBe('unknown');
    expect(classifyLLMError(null).kind).toBe('unknown');
    expect(classifyLLMError(undefined).kind).toBe('unknown');
    expect(classifyLLMError(42).kind).toBe('unknown');
  });

  it('友好提示与排查建议字段存在', () => {
    const r = classifyLLMError(new Error('(401)'));
    expect(typeof r.friendlyMessage).toBe('string');
    expect(r.friendlyMessage.length).toBeGreaterThan(0);
    expect(r.suggestion).toBeDefined();
  });

  it('优先级：401 在前，不会被 network 覆盖', () => {
    // 即使消息里有 "fetch" 字样，401 应优先识别为 auth
    const r = classifyLLMError(new Error('(401) failed to fetch'));
    expect(r.kind).toBe('auth');
  });

  it('优先级：429 在前，不会被 server 覆盖', () => {
    const r = classifyLLMError(new Error('(429) server busy'));
    expect(r.kind).toBe('rate_limit');
  });
});

describe('getCircuitBreakerDuration', () => {
  it('auth 熔断 30 分钟', () => {
    expect(getCircuitBreakerDuration('auth')).toBe(30 * 60 * 1000);
  });

  it('rate_limit 熔断 5 分钟', () => {
    expect(getCircuitBreakerDuration('rate_limit')).toBe(5 * 60 * 1000);
  });

  it('server 熔断 5 分钟', () => {
    expect(getCircuitBreakerDuration('server')).toBe(5 * 60 * 1000);
  });

  it('network 熔断 2 分钟', () => {
    expect(getCircuitBreakerDuration('network')).toBe(2 * 60 * 1000);
  });

  it('timeout 熔断 2 分钟', () => {
    expect(getCircuitBreakerDuration('timeout')).toBe(2 * 60 * 1000);
  });

  it('bad_request 不熔断（0）', () => {
    expect(getCircuitBreakerDuration('bad_request')).toBe(0);
  });

  it('unknown 不熔断（0）', () => {
    expect(getCircuitBreakerDuration('unknown')).toBe(0);
  });
});

describe('getFailureThreshold', () => {
  it('auth 阈值 1（立即熔断）', () => {
    expect(getFailureThreshold('auth')).toBe(1);
  });

  it('rate_limit 阈值 3', () => {
    expect(getFailureThreshold('rate_limit')).toBe(3);
  });

  it('server 阈值 3', () => {
    expect(getFailureThreshold('server')).toBe(3);
  });

  it('network 阈值 3', () => {
    expect(getFailureThreshold('network')).toBe(3);
  });

  it('timeout 阈值 2', () => {
    expect(getFailureThreshold('timeout')).toBe(2);
  });

  it('bad_request 阈值 Infinity（不熔断）', () => {
    expect(getFailureThreshold('bad_request')).toBe(Infinity);
  });

  it('unknown 阈值 Infinity（不熔断）', () => {
    expect(getFailureThreshold('unknown')).toBe(Infinity);
  });
});
