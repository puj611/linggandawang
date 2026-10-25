// src/engine/__tests__/ScreenshotDiagnoser.test.ts
// 截图诊断引擎单测：对比度（WCAG 分块）、对齐/间距/字号降级诊断、canvas 失败兜底
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screenshotDiagnoser } from '../ScreenshotDiagnoser';

/** 构造假 ImageData：fill(x, y) 返回该像素 [r,g,b] */
function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = fill(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height } as ImageData;
}

describe('ScreenshotDiagnoser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('diagnoseContrast', () => {
    it('全灰均匀图：相邻块对比度 1:1，报 high 级 contrast 问题', () => {
      const img = makeImage(64, 64, () => [128, 128, 128]);
      const issues = screenshotDiagnoser.diagnoseContrast(img);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('contrast');
      expect(issues[0].severity).toBe('high');
      expect(issues[0].description).toContain('1.00:1');
    });

    it('黑白棋盘块：相邻对比度 21:1，不报问题', () => {
      const img = makeImage(64, 64, (x, y) => {
        const dark = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        return dark ? [0, 0, 0] : [255, 255, 255];
      });
      expect(screenshotDiagnoser.diagnoseContrast(img)).toEqual([]);
    });

    it('中等对比度（3:1~4.5:1 区间）报 medium', () => {
      // 对角棋盘（灰 100 vs 222，对比度 ≈ 4.4:1）：横竖相邻块均不同色，
      // 最小相邻对比度即 4.4，介于 3 与 4.5 之间 → medium
      // （半灰半深图不行：同色相邻块对比度恒为 1，必报 high）
      const img = makeImage(64, 64, (x, y) =>
        (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? [100, 100, 100] : [222, 222, 222],
      );
      const issues = screenshotDiagnoser.diagnoseContrast(img);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('medium');
    });

    it('尺寸小于 2x2 直接返回空', () => {
      const img = makeImage(1, 1, () => [0, 0, 0]);
      expect(screenshotDiagnoser.diagnoseContrast(img)).toEqual([]);
    });
  });

  describe('diagnoseAlignment', () => {
    it('垂直条纹分散在多列：边缘跨度 > 4px，报 alignment 问题', () => {
      const stripes = new Set([2, 10, 20, 30]);
      const img = makeImage(64, 64, (x) => (stripes.has(x) ? [0, 0, 0] : [255, 255, 255]));
      const issues = screenshotDiagnoser.diagnoseAlignment(img);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('alignment');
      expect(issues[0].description).toContain('对齐');
    });

    it('均匀图无边检测，不报问题', () => {
      const img = makeImage(64, 64, () => [200, 200, 200]);
      expect(screenshotDiagnoser.diagnoseAlignment(img)).toEqual([]);
    });

    it('尺寸小于 4x4 返回空', () => {
      const img = makeImage(2, 2, () => [0, 0, 0]);
      expect(screenshotDiagnoser.diagnoseAlignment(img)).toEqual([]);
    });
  });

  describe('diagnoseSpacing', () => {
    it('空白行长短不一（变异系数 > 0.4）：报 spacing 问题', () => {
      // 算法以「全体行均值的 ±10」判定空白行：bg=200 占 61 行，3 条纯黑内容行
      // 落在 {8,40,58} → 空白 run = [8,31,17,5]，变异系数 ≈ 0.64
      const contentRows = new Set([8, 40, 58]);
      const img = makeImage(64, 64, (_x, y) =>
        contentRows.has(y) ? [0, 0, 0] : [200, 200, 200],
      );
      const issues = screenshotDiagnoser.diagnoseSpacing(img);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('spacing');
    });

    it('均匀图只有一段空白 run（<3），不报问题', () => {
      const img = makeImage(64, 64, () => [240, 240, 240]);
      expect(screenshotDiagnoser.diagnoseSpacing(img)).toEqual([]);
    });
  });

  describe('diagnoseFontsize', () => {
    it('均匀图只有 1 个字号簇（<3）：报 fontsize 问题', () => {
      const img = makeImage(64, 64, () => [230, 230, 230]);
      const issues = screenshotDiagnoser.diagnoseFontsize(img);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('fontsize');
      expect(issues[0].severity).toBe('low');
    });
  });

  describe('diagnose（端到端，stub canvas）', () => {
    const originalCreate = document.createElement.bind(document);

    function stubCanvas(imageData: ImageData | null) {
      const ctx = imageData ? { drawImage: vi.fn(), getImageData: vi.fn(() => imageData) } : null;
      const fakeCanvas = { width: 0, height: 0, getContext: () => ctx };
      vi.spyOn(document, 'createElement').mockImplementation((((tag: string) => {
        if (tag === 'canvas') return fakeCanvas as unknown as HTMLCanvasElement;
        return originalCreate(tag);
      }) as unknown) as typeof document.createElement);
    }

    it('advancedEnabled=false：对比度问题 + 兜底提示', async () => {
      stubCanvas(makeImage(64, 64, () => [128, 128, 128]));
      vi.stubGlobal(
        'Image',
        class {
          naturalWidth = 64;
          naturalHeight = 64;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          set src(_v: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
      const issues = await screenshotDiagnoser.diagnose({
        dataUrl: 'data:image/png;base64,x',
        width: 64,
        height: 64,
        advancedEnabled: false,
      });
      expect(issues.some((i) => i.type === 'contrast')).toBe(true);
      expect(issues.some((i) => i.type === 'fallback')).toBe(true);
    });

    it('canvas context 不可用：返回 Canvas 失败兜底问题', async () => {
      stubCanvas(null);
      vi.stubGlobal(
        'Image',
        class {
          naturalWidth = 64;
          naturalHeight = 64;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          set src(_v: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
      const issues = await screenshotDiagnoser.diagnose({
        dataUrl: 'data:image/png;base64,x',
        width: 64,
        height: 64,
        advancedEnabled: true,
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('fallback');
      expect(issues[0].description).toContain('Canvas 分析失败');
    });
  });
});
