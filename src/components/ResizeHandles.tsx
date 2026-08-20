// src/components/ResizeHandles.tsx
// v5：8 方向缩放热区 —— 严格贴合面板物理边缘（top/left/right/bottom: 0），
// 零内偏移（无 inset/padding），鼠标贴边立即触发。
// 边条 6px、四角 12×12px（角落命中容差）；z-index 高于内容、
// data-no-drag + stopPropagation 确保 Resize/Drag 互斥。
import type { ResizeEdge } from '@/hooks/useResize';

interface Props {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, edge: ResizeEdge) => void;
}

const EDGE = 6; // 边条厚度
const CORNER = 14; // 角落热区边长

interface HandleDef {
  edge: ResizeEdge;
  style: React.CSSProperties;
  cursor: string;
  label: string;
}

// 8 个热区：全部零偏移贴边（top:0/left:0/right:0/bottom:0）
const HANDLES: HandleDef[] = [
  { edge: 'n', style: { top: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: 'ns-resize', label: '上边缘' },
  { edge: 's', style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE }, cursor: 'ns-resize', label: '下边缘' },
  { edge: 'w', style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: 'ew-resize', label: '左边缘' },
  { edge: 'e', style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE }, cursor: 'ew-resize', label: '右边缘' },
  { edge: 'nw', style: { top: 0, left: 0, width: CORNER, height: CORNER }, cursor: 'nwse-resize', label: '左上角' },
  { edge: 'ne', style: { top: 0, right: 0, width: CORNER, height: CORNER }, cursor: 'nesw-resize', label: '右上角' },
  { edge: 'sw', style: { bottom: 0, left: 0, width: CORNER, height: CORNER }, cursor: 'nesw-resize', label: '左下角' },
  { edge: 'se', style: { bottom: 0, right: 0, width: CORNER, height: CORNER }, cursor: 'nwse-resize', label: '右下角' },
];

export function ResizeHandles({ onPointerDown }: Props) {
  return (
    <>
      {HANDLES.map(({ edge, style, cursor, label }) => (
        <div
          key={edge}
          onPointerDown={(e) => onPointerDown(e, edge)}
          data-no-drag
          role="separator"
          aria-label={`拖动调整${label}`}
          className="absolute z-40"
          style={{ ...style, cursor }}
        />
      ))}
    </>
  );
}
