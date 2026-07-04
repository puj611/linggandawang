// src/lib/llm/withRetry.ts
// 指数退避重试：对可重试的 LLM 错误（rate_limit/server/network/timeout）自动重试
// r5增强：避免瞬时抖动直接降级
import { classifyLLMError } from './error-messages';

/**
 * 对异步操作做指数退避重试。
 *
 * 策略：
 * - 不可重试错误（auth/bad_request/unknown）：立即抛出
 * - 可重试错误（rate_limit/server/network/timeout）：等待后重试
 * - 重试间隔：第 1 次 1s，第 2 次 3s（指数退避 base=1, factor=3）
 * - 最大重试次数：2 次（共 3 次尝试）
 *
 * @param fn 要重试的异步函数
 * @param maxRetries 最大重试次数（默认 2）
 * @returns fn 的返回值
 * @throws 最后一次重试仍失败则抛出原错误
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const classified = classifyLLMError(e);

      // 不可重试：立即抛出
      if (!classified.retryable) {
        throw e;
      }

      // 已是最后一次尝试：抛出
      if (attempt >= maxRetries) {
        console.warn(
          `[withRetry] 重试 ${attempt} 次后仍失败：${classified.kind} - ${classified.friendlyMessage}`,
        );
        throw e;
      }

      // 计算退避时间：第 1 次 1s，第 2 次 3s
      const backoffMs = attempt === 0 ? 1000 : 3000;
      console.warn(
        `[withRetry] ${classified.kind} 错误，${backoffMs}ms 后重试（第 ${attempt + 1}/${maxRetries} 次）`,
      );
      await sleep(backoffMs);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
