// src/hooks/useDrag.ts
// Tauri 桌面端：通过手动调用 startDragging 实现标题栏/把手拖动，并自动保存/恢复窗口位置
// 浏览器环境：降级为 pointer event 手动拖动，通过 CSS translate 偏移实现
import { useEffect, useRef, useCallback, useState } from 'react';
import { isTauri } from '@/lib/env';
import { useWindowStore } from '@/stores/windowStore';

let _LogicalPosition: typeof import('@tauri-apps/api/window').LogicalPosition | null = null;
let _getCurrentWindow: typeof import('@tauri-apps/api/window').getCurrentWindow | null = null;
let _listen: typeof import('@tauri-apps/api/event').listen | null = null;

async function loadTauriDeps() {
  if (!isTauri()) return;
  if (_getCurrentWindow && _listen && _LogicalPosition) return;
  try {
    const windowMod = await import('@tauri-apps/api/window');
    const eventMod = await import('@tauri-apps/api/event');
    _LogicalPosition = windowMod.LogicalPosition;
    _getCurrentWindow = windowMod.getCurrentWindow;
    _listen = eventMod.listen;
  } catch (e) {
    // P3-1 修复：原空 catch 吞错误导致排查困难，记录警告
    console.warn('[useDrag] 加载 Tauri 依赖失败', e);
  }
}

const IGNORE_DRAG_SELECTORS = [
  'button',
  'input',
  'textarea',
  'select',
  'a',
  '[contenteditable="true"]',
  '.no-drag',
  '[data-no-drag]',
].join(',');

function shouldIgnoreDragTarget(target: EventTarget | null, container: Element): boolean {
  if (!(target instanceof Element)) return false;
  const match = target.closest(IGNORE_DRAG_SELECTORS);
  return match ? container.contains(match) : false;
}

export function useDrag() {
  const loadPosition = useWindowStore((s) => s.loadPosition);
  const setPosition = useWindowStore((s) => s.setPosition);
  const initialized = useRef(false);
  const moveTimer = useRef<number | null>(null);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!isTauri()) return;

    let cancelled = false;
    let unlistenMove: (() => void) | null = null;

    (async () => {
      await loadTauriDeps();
      if (cancelled || !_getCurrentWindow || !_listen || !_LogicalPosition) return;

      const appWindow = _getCurrentWindow();

      try {
        await loadPosition();
        const pos = useWindowStore.getState().position;
        if (pos.x >= 0 && pos.y >= 0) {
          await appWindow.setPosition(new _LogicalPosition(pos.x, pos.y));
        }
      } catch (e) {
        console.warn('[useDrag] 恢复窗口位置失败', e);
      }

      try {
        unlistenMove = await _listen('tauri://move', async () => {
          if (moveTimer.current) {
            window.clearTimeout(moveTimer.current);
          }
          moveTimer.current = window.setTimeout(async () => {
            try {
              const pos = await appWindow.outerPosition();
              await setPosition({ x: pos.x, y: pos.y, screen: 'default' });
            } catch (e) {
              // P3-1：拖动结束时持久化位置失败不影响功能，仅记录
              console.warn('[useDrag] 持久化窗口位置失败', e);
            }
          }, 200);
        });
      } catch (e) {
        // P3-1：监听 tauri://move 事件失败
        console.warn('[useDrag] 监听窗口移动事件失败', e);
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenMove) {
        unlistenMove();
      }
      if (moveTimer.current) {
        window.clearTimeout(moveTimer.current);
      }
    };
  }, [loadPosition, setPosition]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    offsetRef.current = { x: dx, y: dy };
    setOffset({ x: dx, y: dy });
  }, []);

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  const onPointerDown = useCallback(async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (shouldIgnoreDragTarget(e.target, e.currentTarget)) return;

    e.preventDefault();

    if (isTauri()) {
      try {
        await loadTauriDeps();
        if (!_getCurrentWindow) return;
        const appWindow = _getCurrentWindow();
        await appWindow.startDragging();
      } catch (err) {
        console.warn('[useDrag] startDragging failed', err);
      }
    } else {
      draggingRef.current = true;
      setDragging(true);
      startRef.current = {
        x: e.clientX - offsetRef.current.x,
        y: e.clientY - offsetRef.current.y,
      };
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    }
  }, [onPointerMove, onPointerUp]);

  const dragProps = {
    style: { cursor: 'grab' } as React.CSSProperties,
    onPointerDown,
  };

  return {
    dragProps,
    offset,
    dragging,
  };
}
