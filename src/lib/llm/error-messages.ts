// src/lib/llm/error-messages.ts
// LLM 错误分类与中文友好提示映射
// r5增强：统一错误分类，便于熔断器决策 + UI 友好展示

/** 错误类型分类（用于熔断策略 + UI 提示） */
export type LLMErrorKind =
  | 'auth' // 401/403：Key 错误或权限不足，不可恢复
  | 'rate_limit' // 429：限流，可恢复（需等待）
  | 'server' // 500/502/503/504：服务商瞬时故障，可恢复
  | 'network' // TypeError: Failed to fetch / DNS / ECONNREFUSED，可恢复
  | 'timeout' // AbortError / 超时，可恢复
  | 'bad_request' // 400：请求格式错，不可恢复
  | 'unknown'; // 其他

/** 错误分类结果 */
export interface ClassifiedError {
  kind: LLMErrorKind;
  /** 是否可重试（rate_limit/server/network/timeout 可重试） */
  retryable: boolean;
  /** 中文友好提示（给用户看） */
  friendlyMessage: string;
  /** 排查建议 */
  suggestion?: string;
}

/**
 * 从错误对象分类 LLM 错误类型。
 * 支持从 Error.message 中提取 HTTP 状态码，或从 Error 类型判断网络/超时。
 */
export function classifyLLMError(e: unknown): ClassifiedError {
  const msg = e instanceof Error ? e.message : String(e);
  const lowerMsg = msg.toLowerCase();

  // 401/403：认证/权限错误
  if (/\(401\)|401[^0-9]/.test(msg) || /\(403\)|403[^0-9]/.test(msg)) {
    return {
      kind: 'auth',
      retryable: false,
      friendlyMessage: 'API Key 无效或已过期',
      suggestion: '请到设置页检查 API Key 是否正确，或重新生成 Key',
    };
  }

  // 429：限流
  if (/\(429\)|429[^0-9]/.test(msg)) {
    return {
      kind: 'rate_limit',
      retryable: true,
      friendlyMessage: '请求过于频繁，被服务商限流',
      suggestion: '请稍后重试，或降低提问频率；如持续限流可考虑更换服务商套餐',
    };
  }

  // 500/502/503/504：服务商故障
  if (/\(50[0234]\)|50[0234][^0-9]/.test(msg)) {
    return {
      kind: 'server',
      retryable: true,
      friendlyMessage: 'AI 服务商暂时不可用',
      suggestion: '服务商服务器故障，请稍后重试；如持续不可用可切换服务商',
    };
  }

  // 400：请求格式错
  if (/\(400\)|400[^0-9]/.test(msg)) {
    return {
      kind: 'bad_request',
      retryable: false,
      friendlyMessage: '请求格式错误',
      suggestion: '可能是模型配置有误，请检查模型名称是否正确',
    };
  }

  // 超时
  if (
    e instanceof Error &&
    (e.name === 'AbortError' || lowerMsg.includes('超时') || lowerMsg.includes('timeout'))
  ) {
    return {
      kind: 'timeout',
      retryable: true,
      friendlyMessage: 'AI 响应超时',
      suggestion: '网络较慢或服务商响应过慢，请重试；可考虑更换更快的模型',
    };
  }

  // 网络错误（fetch failed / DNS / ECONNREFUSED）
  if (
    e instanceof TypeError ||
    lowerMsg.includes('failed to fetch') ||
    lowerMsg.includes('networkerror') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('dns')
  ) {
    return {
      kind: 'network',
      retryable: true,
      friendlyMessage: '网络连接失败',
      suggestion: '请检查网络连接；如使用代理请确认代理可用；服务商地址是否正确',
    };
  }

  // 其他未知错误
  return {
    kind: 'unknown',
    retryable: false,
    friendlyMessage: 'AI 调用失败',
    suggestion: msg.slice(0, 100),
  };
}

/**
 * 根据错误类型获取熔断时长（毫秒）。
 * - auth：30 分钟（Key 问题不会自愈）
 * - rate_limit：5 分钟
 * - server：5 分钟
 * - network：2 分钟
 * - timeout：2 分钟
 * - 其他：不熔断
 */
export function getCircuitBreakerDuration(kind: LLMErrorKind): number {
  switch (kind) {
    case 'auth':
      return 30 * 60 * 1000; // 30 分钟
    case 'rate_limit':
    case 'server':
      return 5 * 60 * 1000; // 5 分钟
    case 'network':
    case 'timeout':
      return 2 * 60 * 1000; // 2 分钟
    default:
      return 0;
  }
}

/**
 * 根据错误类型获取连续失败次数阈值（达到后熔断）。
 * - auth：1 次（立即熔断，Key 问题不会自愈）
 * - rate_limit/server/network：3 次
 * - timeout：2 次
 * - 其他：Infinity（不熔断）
 */
export function getFailureThreshold(kind: LLMErrorKind): number {
  switch (kind) {
    case 'auth':
      return 1;
    case 'rate_limit':
    case 'server':
    case 'network':
      return 3;
    case 'timeout':
      return 2;
    default:
      return Infinity;
  }
}
