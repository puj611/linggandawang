// src/hooks/useResize.ts
// v6 重写：8 方向边缘缩放 + OS 窗口同步 + Resize/Drag 互斥 + 锚定补偿
// 修复三个底层 Bug：
//  1) 热区偏移 —— 把手严格贴边（top/left/right/bottom: 0，零内偏移）
//  2) 横向极限变拖动 —— setPointerCapture + 互斥锁；宽高严格 clamp，极限锁定
//  3) 纵向失效 —— v6 修复：改用「handle 级」指针捕获绑定（不再 document 常驻监听），
//     彻底消除 Tauri 缩窗导致的 stale 会话（edgeRef 卡死 → 纵向失效 + 永久锁死 Drag）
// 新增：锚定补偿 —— 面板原生处于 flex 居中容器，拉一边会因居中导致对向也动；
//       按 edge 计算 translate 补偿，保证「只动被拉的那边」。
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@/lib/env';
import {
  useWindowStore,
  MIN_WINDOW_WIDTH,
  MAX_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MAX_WINDOW_HEIGHT,
} from '@/stores/windowStore';

/** 缩放方向：8 个边缘/角落 */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// ===== Resize / Drag 互斥状态机（模块级单例）=====
let resizeActive = false;
/** useDrag 在 pointerdown 时调用：缩放会话进行中禁止任何窗口拖动 */
export function isResizing(): boolean {
  return resizeActive;
}

function clampWidth(v: number): number {
  return Math.min(MAX_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, Math.round(v)));
}
function clampHeight(v: number): number {
  return Math.min(MAX_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, Math.round(v)));
}

/**
 * 锚定补偿：OS 窗口 setSize 默认以左上角为锚点。
 * 对 n/w 侧缩放需同时平移窗口，使「被拉的那边」独立移动、对边保持固定。
 * 返回应平移的 (dx, dy)。e/s 侧无需平移（返回 0），由 setSize 天然锚定。
 */
export function computeAnchorOffset(
  edge: ResizeEdge,
  startW: number,
  startH: number,
  newW: number,
  newH: number,
): { dx: number; dy: number } {
  const dx = edge.includes('w') ? startW - newW : 0;
  const dy = edge.includes('n') ? startH - newH : 0;
  return { dx, dy };
}

// Tauri 窗口 API 懒加载缓存
let _LogicalSize: typeof import('@tauri-apps/api/window').LogicalSize | null = null;
let _LogicalPosition: typeof import('@tauri-apps/api/window').LogicalPosition | null = null;
let _getCurrentWindow: typeof import('@tauri-apps/api/window').getCurrentWindow | null = null;

async function loadTauriDeps(): Promise<boolean> {
  if (!isTauri()) return false;
  if (_LogicalSize && _LogicalPosition && _getCurrentWindow) return true;
  try {
    const windowMod = await import('@tauri-apps/api/window');
    _LogicalSize = windowMod.LogicalSize;
    _LogicalPosition = windowMod.LogicalPosition;
    _getCurrentWindow = windowMod.getCurrentWindow;
    return true;
  } catch (e) {
    console.warn('[useResize] 加载 Tauri 依赖失败', e);
    return false;
  }
}

/** stale 会话超时：2000ms 无移动自动结束，防止 pointerup 丢失后锁死 */
const STALE_TIMEOUT = 2000;

export function useResize() {
  const width = useWindowStore((s) => s.width);
  const height = useWindowStore((s) => s.height);
  const setWidth = useWindowStore((s) => s.setWidth);
  const setHeight = useWindowStore((s) => s.setHeight);
  const applyPanelSize = useWindowStore((s) => s.applyPanelSize);

  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);
  const edgeRef = useRef<ResizeEdge | null>(null);
  const startRef = useRef({ px: 0, py: 0, w: 0, h: 0, winX: 0, winY: 0 });
  const applyInFlight = useRef(false);
  const activeHandle = useRef<HTMLElement | null>(null);
  const activePointerId = useRef(-1);
  const sessionTimer = useRef<number | null>(null);
  // rAF 合并：pointermove 频率可高于渲染帧率，暂存最新待应用尺寸，一帧只应用一次
  const pendingApply = useRef<{ w: number; h: number; edge: ResizeEdge } | null>(null);
  const pendingRaf = useRef(0);

  // 面板挂载：把 OS 窗口同步为面板尺寸（一次）
  useEffect(() => {
    void applyPanelSize();
  }, [applyPanelSize]);

  /** Tauri：把 clamp 后的宽高应用到 OS 窗口；n/w 边缘同时平移窗口保持对角固定 */
  const applyToWindow = useCallback(async (w: number, h: number, edge: ResizeEdge) => {
    if (!applyInFlight.current) {
      applyInFlight.current = true;
      try {
        const appWindow = _getCurrentWindow!();
        await appWindow.setSize(new _LogicalSize!(w, h));
        const { dx, dy } = computeAnchorOffset(edge, startRef.current.w, startRef.current.h, w, h);
        if (dx !== 0 || dy !== 0) {
          await appWindow.setPosition(
            new _LogicalPosition!(startRef.current.winX + dx, startRef.current.winY + dy),
          );
        }
      } catch (e) {
        console.warn('[useResize] 同步窗口尺寸失败', e);
      } finally {
        applyInFlight.current = false;
      }
    }
  }, []);

  /** rAF flush：应用最新待应用尺寸（写 store + 同步 OS 窗口），并清除调度标记 */
  const flushPending = useCallback(() => {
    pendingRaf.current = 0;
    const pending = pendingApply.current;
    pendingApply.current = null;
    if (!pending) return;
    // 内存更新，持久化由 pointerup 兜底
    useWindowStore.setState({ width: pending.w, height: pending.h });
    // Tauri：OS 窗口跟随。锚定由 setSize(左上角锚点) + n/w 平移 实现，
    // 保证「只动被拉的那边」，对边固定（无需 CSS transform 补偿）。
    if (_getCurrentWindow) {
      void applyToWindow(pending.w, pending.h, pending.edge);
    }
  }, [applyToWindow]);

  /** 结束会话：统一清理 handle 级监听、释放捕获、解锁互斥、持久化 */
  const endResize = useCallback(() => {
    // 收尾：取消未决 rAF 并同步 flush 最后一帧尺寸（须在下方读取 store 持久化之前），避免丢失
    if (pendingRaf.current !== 0) {
      window.cancelAnimationFrame(pendingRaf.current);
      flushPending();
    }
    const handle = activeHandle.current;
    if (handle) {
      handle.removeEventListener('pointermove', moveHandlerRef.current);
      handle.removeEventListener('pointerup', upHandlerRef.current);
      handle.removeEventListener('pointercancel', upHandlerRef.current);
      try {
        if (activePointerId.current >= 0 && handle.hasPointerCapture(activePointerId.current)) {
          handle.releasePointerCapture(activePointerId.current);
        }
      } catch {
        /* ignore */
      }
    }
    activeHandle.current = null;
    activePointerId.current = -1;
    if (sessionTimer.current) {
      window.clearTimeout(sessionTimer.current);
      sessionTimer.current = null;
    }
    resizingRef.current = false;
    resizeActive = false; // 释放互斥锁：此后才允许 Drag
    edgeRef.current = null;
    setResizing(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    const { width: w, height: h } = useWindowStore.getState();
    void setWidth(w);
    void setHeight(h);
  }, [setWidth, setHeight, flushPending]);

  // 用 ref 持有 handler，避免 endResize 与 move/up 的闭包循环引用
  const moveHandlerRef = useRef<(e: PointerEvent) => void>(() => {});
  const upHandlerRef = useRef<(e: PointerEvent) => void>(() => {});

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const edge = edgeRef.current;
      if (!edge || !resizingRef.current) return;
      const dx = e.clientX - startRef.current.px;
      const dy = e.clientY - startRef.current.py;
      const { w: w0, h: h0 } = startRef.current;

      // 方向解算 + 严格钳制：达到极限即锁定，绝不产生平移
      let w = w0;
      let h = h0;
      if (edge.includes('e')) w = clampWidth(w0 + dx);
      if (edge.includes('w')) w = clampWidth(w0 - dx);
      if (edge.includes('s')) h = clampHeight(h0 + dy);
      if (edge.includes('n')) h = clampHeight(h0 - dy);

      // 副作用 rAF 合并（P3）：pointermove 触发频率可高于渲染帧率，
      // 把 setState + applyToWindow 两个副作用暂存为最新值，每帧只 flush 一次；
      // 方向解算/钳制等轻量计算与 stale 超时刷新仍留在事件回调内。
      pendingApply.current = { w, h, edge };
      if (pendingRaf.current === 0) {
        pendingRaf.current = window.requestAnimationFrame(flushPending);
      }

      // 刷新 stale 超时
      if (sessionTimer.current) window.clearTimeout(sessionTimer.current);
      sessionTimer.current = window.setTimeout(() => endResize(), STALE_TIMEOUT);
    },
    [flushPending, endResize],
  );

  const onPointerUp = useCallback(() => {
    endResize();
  }, [endResize]);

  // 把 handler 写入 ref（供 handle.addEventListener 使用，且保持引用稳定）
  moveHandlerRef.current = onPointerMove;
  upHandlerRef.current = onPointerUp;

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, edge: ResizeEdge) => {
      if (e.button !== 0) return;
      // 若残留 stale 会话，先强制清理，避免污染新会话
      endResize();
      // 互斥状态机：抢占锁，阻止本次手势冒泡成 Drag
      e.preventDefault();
      e.stopPropagation();
      resizeActive = true;
      resizingRef.current = true;
      edgeRef.current = edge;
      activeHandle.current = e.currentTarget;
      activePointerId.current = e.pointerId;
      setResizing(true);

      // 指针捕获：绑定在 handle 自身，拖出窗口/缩窗后 pointerup/pointercancel 仍必达
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* 旧浏览器降级：handle 级监听兜底 */
      }

      const st = useWindowStore.getState();
      startRef.current = {
        px: e.clientX,
        py: e.clientY,
        w: st.width,
        h: st.height,
        winX: 0,
        winY: 0,
      };

      // Tauri：记录窗口起始坐标（n/w 边缘 setPosition 用）
      if (isTauri()) {
        void loadTauriDeps().then((ok) => {
          if (!ok || !_getCurrentWindow) return;
          const win = _getCurrentWindow();
          win
            .outerPosition()
            .then((pos) =>
              win
                .scaleFactor()
                .then((scale) => {
                  startRef.current.winX = pos.x / scale;
                  startRef.current.winY = pos.y / scale;
                }),
            )
            .catch(() => {});
        });
      }

      // 监听绑定在 handle 自身（capture 保证跟随指针）
      // 使用 moveHandlerRef/upHandlerRef 而非 onPointerMove/onPointerUp 直接引用，
      // 确保 endResize 中 removeEventListener 移除的是同一个函数引用，避免 listener 泄漏。
      const handle = e.currentTarget;
      handle.addEventListener('pointermove', moveHandlerRef.current);
      handle.addEventListener('pointerup', upHandlerRef.current);
      handle.addEventListener('pointercancel', upHandlerRef.current);

      document.body.style.userSelect = 'none';
      const cursorMap: Record<string, string> = {
        n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
        ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
      };
      document.body.style.cursor = cursorMap[edge] ?? 'default';

      // stale 超时兜底
      if (sessionTimer.current) window.clearTimeout(sessionTimer.current);
      sessionTimer.current = window.setTimeout(() => endResize(), STALE_TIMEOUT);
    },
    [endResize],
  );

  // 卸载兜底清理
  useEffect(() => {
    return () => endResize();
  }, [endResize]);

  return { onPointerDown, width, height, resizing };
}