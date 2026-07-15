// src/components/Ball.tsx
// 收起态：悬浮球
// 右键菜单（P1.5 其他改进）：暂停驻留 / 设置 / 退出
import { useEffect, useState, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useDrag } from '@/hooks/useDrag';
import { useHotkey, useEscKey } from '@/hooks/useHotkey';
import { useWindowStore } from '@/stores/windowStore';
import { isTauri } from '@/lib/env';

const BALL_SIZE = 50;

interface MenuPos {
  x: number;
  y: number;
}

export function Ball() {
  const toggleExpand = useAppStore((s) => s.toggleExpand);
  const openSettings = useAppStore((s) => s.openSettings);
  const { dragProps, offset, dragging } = useDrag();

  const expand = useAppStore((s) => s.expand);
  const collapse = useAppStore((s) => s.collapse);

  // P1.5 其他改进：右键菜单状态
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos>({ x: 0, y: 0 });

  // 拖动检测：记录 pointerdown 位置，pointerup 时判断是否发生了拖动
  const didDragRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const DRAG_THRESHOLD = 4; // 超过 4px 视为拖动

  // 暂停驻留 = 切换窗口置顶（alwaysOnTop）
  const alwaysOnTop = useWindowStore((s) => s.alwaysOnTop);
  const toggleAlwaysOnTop = useWindowStore((s) => s.toggleAlwaysOnTop);

  useHotkey(expand, collapse);
  useEscKey(collapse);

  const onClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // 若菜单正打开，单击先关闭菜单而非展开
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    // 如果发生了拖动，不触发点击展开
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    toggleExpand();
  };

  const onBallPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    didDragRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const onBallPointerMove = (e: React.PointerEvent) => {
    if (!pointerStartRef.current) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      didDragRef.current = true;
    }
  };

  const onBallPointerUp = () => {
    pointerStartRef.current = { x: 0, y: 0 };
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  };

  // 点击外部 / ESC 关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onClickAway = () => setMenuOpen(false);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    // 延迟一帧绑定，避免触发菜单的同一次 click 立即关闭
    const id = window.setTimeout(() => {
      document.addEventListener('click', onClickAway);
      document.addEventListener('keydown', onEsc);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('click', onClickAway);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  const onMenuPause = () => {
    setMenuOpen(false);
    void toggleAlwaysOnTop();
  };

  const onMenuSettings = () => {
    setMenuOpen(false);
    openSettings();
  };

  const onMenuQuit = async () => {
    setMenuOpen(false);
    if (!isTauri()) {
      // 浏览器降级：尝试关闭标签页（通常会被浏览器拦截）
      window.close();
      return;
    }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (e) {
      console.warn('[Ball] 退出窗口失败', e);
    }
  };

  return (
    <>
      <div
        {...dragProps}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onPointerDown={onBallPointerDown}
        onPointerMove={onBallPointerMove}
        onPointerUp={onBallPointerUp}
        className={`fixed group z-[9999] rounded-full flex items-center justify-center select-none ${
          dragging ? '' : 'transition-all duration-200 hover:scale-110'
        }`}
        style={{
          left: '50%',
          top: '50%',
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
          width: BALL_SIZE,
          height: BALL_SIZE,
          background: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
          boxShadow: dragging
            ? '0 10px 36px rgba(139,92,246,0.55)'
            : '0 6px 24px rgba(139,92,246,0.4)',
          cursor: dragProps.style?.cursor,
        }}
        title="拖动移动 / 单击展开 / 右键菜单 / Alt+Shift+Space 切换"
        aria-label="灵感大王悬浮球"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.3))' }}
        >
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
        </svg>
      </div>

      {/* P1.5 其他改进：右键浮动菜单 */}
      {menuOpen && (
        <div
          className="fixed bg-surface-2 border border-border rounded-btn shadow-popover py-1 min-w-[140px] text-text-primary"
          style={{
            left: menuPos.x,
            top: menuPos.y,
            zIndex: 10001,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onMenuPause}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
            {alwaysOnTop ? '暂停驻留' : '恢复驻留'}
          </button>
          <button
            type="button"
            onClick={onMenuSettings}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            设置
          </button>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={onMenuQuit}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors flex items-center gap-2 text-red-400"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            退出
          </button>
        </div>
      )}
    </>
  );
}
