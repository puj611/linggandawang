// src/lib/withTimeout.ts
// 通用超时包装器：给任意 Promise 添加超时保护
// 用于防止 Tauri invoke 等 async 操作永久挂起导致 UI 卡死

/**
 * 给 Promise 添加超时保护。
 * - 超时后 reject（原 Promise 继续在后台运行，但不阻塞调用方）
 * - 始终清理定时器，避免内存泄漏
 *
 * @param promise  要包装的 Promise
 * @param ms       超时毫秒数
 * @param label    超时标签（用于错误信息识别）
 * @returns 原 Promise 的结果，或超时后 reject TimeoutError
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[timeout] ${label} exceeded ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 安全执行 async 操作：超时或出错时返回 fallback 值，绝不 throw。
 * 用于非关键路径（如持久化），失败不应阻塞主流程。
 */
export async function withTimeoutSafe<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  fallback: T,
): Promise<{ ok: boolean; value: T; error?: string }> {
  try {
    const value = await withTimeout(promise, ms, label);
    return { ok: true, value };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[withTimeoutSafe] ${label} failed: ${error}`);
    return { ok: false, value: fallback, error };
  }
}
