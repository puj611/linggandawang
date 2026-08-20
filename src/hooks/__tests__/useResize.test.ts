// src/hooks/__tests__/useResize.test.ts
// 验证锚定补偿：缩放时「只动被拉的那边」，对边固定。
import { describe, it, expect } from 'vitest';
import { computeAnchorOffset } from '../useResize';

describe('computeAnchorOffset', () => {
  // 940 起点：宽 400 高 680
  const startW = 400;
  const startH = 680;

  it('e 侧：无需平移，仅右下角方向增长', () => {
    expect(computeAnchorOffset('e', startW, startH, 500, 680)).toEqual({ dx: 0, dy: 0 });
  });

  it('s 侧：无需平移，仅向下增长', () => {
    expect(computeAnchorOffset('s', startW, startH, 400, 780)).toEqual({ dx: 0, dy: 0 });
  });

  it('w 侧：向左平移差值，右边缘保持固定', () => {
    // 新宽 500 > 旧宽 400，右边缘想固定 → 左边缘需向左移 100
    expect(computeAnchorOffset('w', startW, startH, 500, 680)).toEqual({ dx: -100, dy: 0 });
  });

  it('n 侧：向上平移差值，下边缘保持固定', () => {
    expect(computeAnchorOffset('n', startW, startH, 400, 780)).toEqual({ dx: 0, dy: -100 });
  });

  it('se 角落：e/s 均无平移', () => {
    expect(computeAnchorOffset('se', startW, startH, 500, 780)).toEqual({ dx: 0, dy: 0 });
  });

  it('nw 角落：w/n 两个方向都平移', () => {
    expect(computeAnchorOffset('nw', startW, startH, 500, 780)).toEqual({ dx: -100, dy: -100 });
  });
});