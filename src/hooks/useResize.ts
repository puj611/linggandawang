// src/hooks/useResize.ts
// P1.5：悬浮窗右下角宽度可调 hook
// 拖动把手时改变 width，范围 [MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH]
// 宽度持久化到 windowStore（key: window_width，底层写入 user_preferences）
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowStore, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH } from '@/stores/windowStore';

export function useResize() {
  const width = useWindowStore((s) => s.width);
  const setWidth = useWindowStore((s) => s.setWidth);

  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  // 拖动起始：记录鼠标 clientX 和当时面板宽度
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  // 节流写入 store 的定时器
  const persistTimer = useRef<number | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - startXRef.current;
    const next = Math.min(
      MAX_WINDOW_WIDTH,
      Math.max(MIN_WINDOW_WIDTH, Math.round(startWidthRef.current + dx)),
    );
    // 即时更新 store（setWidth 会 clamp，set 部分同步内存）
    useWindowStore.setState({ width: next });
  }, []);

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    // 拖动结束时持久化最终宽度
    if (persistTimer.current) {
      window.clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    void setWidth(useWindowStore.getState().width);
  }, [onPointerMove, setWidth]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 仅响应左键
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      setDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = useWindowStore.getState().width;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  // 拖动过程中节流持久化（每 300ms 落盘一次），避免高频写 SQLite
  useEffect(() => {
    if (!dragging) return;
    persistTimer.current = window.setInterval(() => {
      void setWidth(useWindowStore.getState().width);
    }, 300);
    return () => {
      if (persistTimer.current) {
        window.clearInterval(persistTimer.current);
        persistTimer.current = null;
      }
    };
  }, [dragging, setWidth]);

  // 组件卸载时兜底清理
  useEffect(() => {
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [onPointerMove, onPointerUp]);

  // 透传给 resize 把手 div 的属性
  const resizeProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    style: React.CSSProperties;
    role: string;
    'aria-label': string;
  } = {
    onPointerDown,
    style: { cursor: 'ew-resize' } as React.CSSProperties,
    role: 'separator',
    'aria-label': '拖动调整宽度',
  };

  return { resizeProps, width, dragging };
}
