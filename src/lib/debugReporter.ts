// src/lib/debugReporter.ts
// 调试会话专用：通过 HTTP 上报到 TRAE-debugger Debug Server
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

/** 上报调试事件（fire-and-forget，失败静默，绝不影响业务） */
export function reportDebug(ev: DebugEvent): void {
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
// #endregion debug-instrumentation
