// src/components/Ball.tsx
// 收起态：悬浮球
import { useAppStore } from '@/stores/appStore';
import { useDrag } from '@/hooks/useDrag';
import { useHotkey, useEscKey } from '@/hooks/useHotkey';

const BALL_SIZE = 50;

export function Ball() {
  const toggleExpand = useAppStore((s) => s.toggleExpand);
  const openSettings = useAppStore((s) => s.openSettings);
  const { dragProps, offset, dragging } = useDrag();

  const expand = useAppStore((s) => s.expand);
  const collapse = useAppStore((s) => s.collapse);

  useHotkey(expand, collapse);
  useEscKey(collapse);

  const onClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    toggleExpand();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openSettings();
  };

  return (
    <div
      {...dragProps}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
      title="拖动移动 / 单击展开 / 右键设置 / Alt+Shift+Space 切换"
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
  );
}
