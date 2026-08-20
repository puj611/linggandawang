// src/lib/debugReporter.ts
// 调试会话专用：通过 HTTP 上报到 TRAE-debugger Debug Server
// 仅开发模式生效（import.meta.env.DEV）：生产构建中 reportDebug 为 no-op，不发出任何网络请求
// 会话结束后会与本文件一起清理
// #region debug-instrumentation
const DEBUG_URL = 'http://127.0.0.1:7777/event';
const DEBUG_SESSION = 'prompt-generating-stuck';

let runId: string = 'pre'; // 'pre' 修复前 / 'post' 修复后
export function setDebugRunId(id: 'pre' | 'post') { runId = id; }

let seq = 0;
function nextSeq(): number { seq += 1; return seq; }

export interface DebugEvent {
  point: string;          // 插桩点 ID，如 'finishAndGenerate.enter'
  phase: 'start' | 'end' | 'info' | 'error';
  hypothesisId?: 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
  data?: Record<string, unknown>;
  error?: string;
}

/** 上报调试事件（fire-and-forget，失败静默，绝不影响业务）
 *  仅开发模式生效：生产构建中直接 no-op，杜绝调试数据外发（安全 S1） */
export function reportDebug(ev: DebugEvent): void {
  if (!import.meta.env.DEV) return; // 生产模式短路，不构造 payload、不发起任何网络请求
  const payload = {
    session_id: DEBUG_SESSION,
    run_id: runId,
    seq: nextSeq(),
    ts: Date.now(),
    point: ev.point,
    phase: ev.phase,
    hypothesisId: ev.hypothesisId,
    data: ev.data ?? {},
    error: ev.error,
  };
  try {
    // 用 navigator.sendBeacon 优先，避免 fetch 在卸载时被取消
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(DEBUG_URL, blob);
      if (ok) return;
    }
    // 降级 fetch keepalive
    void fetch(DEBUG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 静默失败
  }
}

/** 测量一段同步/异步函数的耗时并上报 start/end 事件 */
export async function traceAsync<T>(
  point: string,
  hypothesisId: DebugEvent['hypothesisId'],
  fn: () => Promise<T>,
): Promise<T> {
  const startTs = performance.now();
  reportDebug({ point, phase: 'start', hypothesisId, data: { startPerf: startTs } });
  try {
    const r = await fn();
    reportDebug({ point, phase: 'end', hypothesisId, data: { durationMs: Math.round(performance.now() - startTs) } });
    return r;
  } catch (e) {
    reportDebug({ point, phase: 'error', hypothesisId, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), data: { durationMs: Math.round(performance.now() - startTs) } });
    throw e;
  }
}

// #region debug-point canary — 模块级，import/HMR 时立即触发，用于验证日志管线是否连通
// 若此 canary 到达 Debug Server，证明：(1) WebView 加载的是 Vite 服务的插桩代码 (2) CSP 放行 7777 (3) sendBeacon/fetch 工作
// 若不到达，证明 WebView 加载的是 dist/ 旧构建（无 HMR）或 CSP 拦截
try {
  reportDebug({ point: 'canary.moduleLoad', phase: 'info', data: { href: typeof location !== 'undefined' ? location.href : 'unknown', ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'unknown' } });
} catch {}
// #endregion debug-point canary
// #endregion debug-instrumentation
