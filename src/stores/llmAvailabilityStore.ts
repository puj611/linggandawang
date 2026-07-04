// src/stores/llmAvailabilityStore.ts
// LLM 可用性状态机：会话级熔断器 + 自动降级
// r5增强：连续失败达阈值后熔断，熔断期间跳过 LLM 调用直接降级到基础模式
import { create } from 'zustand';
import {
  classifyLLMError,
  getCircuitBreakerDuration,
  getFailureThreshold,
  type LLMErrorKind,
} from '@/lib/llm/error-messages';

/** LLM 可用性状态 */
export type LLMAvailabilityStatus = 'unknown' | 'available' | 'degraded';

interface LLMAvailabilityState {
  /** 当前状态 */
  status: LLMAvailabilityStatus;
  /** 连续失败次数（按错误类型分别计数） */
  consecutiveFailures: Partial<Record<LLMErrorKind, number>>;
  /** 最近一次失败时间戳 */
  lastFailureAt: number | null;
  /** 最近一次失败的错误类型 */
  lastFailureKind: LLMErrorKind | null;
  /** 熔断到期时间戳（degraded 状态下，到期后允许半开探测） */
  degradeUntil: number | null;
  /** 最近一次失败的用户友好提示 */
  lastFriendlyMessage: string | null;
  /** 最近一次失败的排查建议 */
  lastSuggestion: string | null;

  /** 调用成功：重置失败计数，状态切回 available */
  recordSuccess: () => void;
  /** 调用失败：累加失败计数，达阈值则熔断 */
  recordFailure: (e: unknown) => void;
  /** 调用前检查：是否应该尝试 LLM 调用（熔断中返回 false） */
  shouldAttempt: () => boolean;
  /** 手动重置（用户点击"立即重试"） */
  reset: () => void;
  /** 获取状态消息（给 UI 展示） */
  getStatusMessage: () => { text: string; level: 'info' | 'warn' | 'error' } | null;
}

export const useLLMAvailabilityStore = create<LLMAvailabilityState>((set, get) => ({
  status: 'unknown',
  consecutiveFailures: {},
  lastFailureAt: null,
  lastFailureKind: null,
  degradeUntil: null,
  lastFriendlyMessage: null,
  lastSuggestion: null,

  recordSuccess: () => {
    set({
      status: 'available',
      consecutiveFailures: {},
      lastFailureAt: null,
      lastFailureKind: null,
      degradeUntil: null,
      lastFriendlyMessage: null,
      lastSuggestion: null,
    });
  },

  recordFailure: (e: unknown) => {
    const classified = classifyLLMError(e);
    const now = Date.now();
    const prevFailures = get().consecutiveFailures[classified.kind] ?? 0;
    const newFailures = prevFailures + 1;
    const threshold = getFailureThreshold(classified.kind);

    // 更新失败计数
    const newConsecutiveFailures = {
      ...get().consecutiveFailures,
      [classified.kind]: newFailures,
    };

    // 达阈值则熔断
    if (newFailures >= threshold) {
      const duration = getCircuitBreakerDuration(classified.kind);
      if (duration > 0) {
        set({
          status: 'degraded',
          consecutiveFailures: newConsecutiveFailures,
          lastFailureAt: now,
          lastFailureKind: classified.kind,
          degradeUntil: now + duration,
          lastFriendlyMessage: classified.friendlyMessage,
          lastSuggestion: classified.suggestion,
        });
        console.warn(
          `[LLMAvailability] 熔断触发：${classified.kind} 连续失败 ${newFailures} 次，熔断 ${duration / 1000}s`,
        );
        return;
      }
    }

    // 未达阈值或无需熔断的错误类型，仅记录
    set({
      consecutiveFailures: newConsecutiveFailures,
      lastFailureAt: now,
      lastFailureKind: classified.kind,
      lastFriendlyMessage: classified.friendlyMessage,
      lastSuggestion: classified.suggestion,
    });
  },

  shouldAttempt: () => {
    const { status, degradeUntil } = get();
    if (status !== 'degraded') return true;
    if (!degradeUntil) return true;
    // 熔断到期，允许半开探测（不主动重置状态，等成功后再切回 available）
    if (Date.now() >= degradeUntil) {
      console.info('[LLMAvailability] 熔断到期，进入半开探测');
      return true;
    }
    return false;
  },

  reset: () => {
    set({
      status: 'unknown',
      consecutiveFailures: {},
      lastFailureAt: null,
      lastFailureKind: null,
      degradeUntil: null,
      lastFriendlyMessage: null,
      lastSuggestion: null,
    });
    console.info('[LLMAvailability] 手动重置');
  },

  getStatusMessage: () => {
    const { status, lastFriendlyMessage, lastSuggestion, degradeUntil } = get();
    if (status !== 'degraded') return null;
    const remainingMs = degradeUntil ? degradeUntil - Date.now() : 0;
    const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
    const text = lastSuggestion
      ? `AI 智能增强暂时不可用（${lastFriendlyMessage}），已切换为基础模式。${remainingMin > 0 ? `将在 ${remainingMin} 分钟后自动重试。` : ''}建议：${lastSuggestion}`
      : `AI 智能增强暂时不可用（${lastFriendlyMessage}），已切换为基础模式。${remainingMin > 0 ? `将在 ${remainingMin} 分钟后自动重试。` : ''}`;
    return { text, level: 'warn' as const };
  },
}));
