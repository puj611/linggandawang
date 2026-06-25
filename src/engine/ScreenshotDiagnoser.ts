// src/engine/ScreenshotDiagnoser.ts
// 截图诊断：对比度走 Canvas + WCAG 公式（必做），对齐/间距/字号降级为兜底问题
// DOWNGRADE: 原计划 Rust image crate 实现，Rust 不可用，前端 Canvas 降级
import type { DiagnosisIssue } from '@/components/DiagnosisReport';

export interface DiagnosisInput {
  dataUrl: string;
  width: number;
  height: number;
  advancedEnabled: boolean; // 对齐/间距/字号开关
}

export class ScreenshotDiagnoser {
  /** 加载图片到 ImageData */
  private async loadImageData(dataUrl: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // 缩放到合理尺寸以加速（最长边 256）
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.floor(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.floor(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          reject(new Error('Canvas 2D context 不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve(data);
        } catch (e) {
          reject(new Error('getImageData 失败：' + (e as Error).message));
        }
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = dataUrl;
    });
  }

  /** 主诊断入口 */
  async diagnose(input: DiagnosisInput): Promise<DiagnosisIssue[]> {
    const issues: DiagnosisIssue[] = [];
    try {
      const imgData = await this.loadImageData(input.dataUrl);
      // 1. 对比度（必做）
      issues.push(...this.diagnoseContrast(imgData));
      // 2. 高级诊断（降级为兜底提示）
      if (input.advancedEnabled) {
        issues.push(...this.diagnoseAlignment(imgData));
        issues.push(...this.diagnoseSpacing(imgData));
        issues.push(...this.diagnoseFontsize(imgData));
      } else {
        // DOWNGRADE: 对齐/间距/字号降级为兜底问题
        issues.push({
          type: 'fallback',
          severity: 'low',
          description: '对齐/间距/字号识别功能升级中，请用文字描述',
          suggestion: '检查左边缘是否对齐、间距是否一致、字号是否分 ≥ 3 级',
        });
      }
    } catch (e) {
      issues.push({
        type: 'fallback',
        severity: 'low',
        description: `Canvas 分析失败：${(e as Error).message}`,
        suggestion: '请用文字描述视觉问题',
      });
    }
    return issues;
  }

  /** WCAG 相对亮度 */
  private relativeLuminance(r: number, g: number, b: number): number {
    const toLin = (c: number) => {
      const cs = c / 255;
      return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  }

  /** 对比度比 */
  private contrastRatio(l1: number, l2: number): number {
    const light = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
  }

  /** 对比度诊断：把图像分块，找相邻块最大对比度与最小对比度 */
  diagnoseContrast(imgData: ImageData): DiagnosisIssue[] {
    const { data, width, height } = imgData;
    if (width < 2 || height < 2) return [];

    // 把图像分成 8x8 块，每块取平均颜色
    const blockW = Math.max(1, Math.floor(width / 8));
    const blockH = Math.max(1, Math.floor(height / 8));
    const blocks: { r: number; g: number; b: number; x: number; y: number }[] = [];
    for (let by = 0; by < 8; by++) {
      for (let bx = 0; bx < 8; bx++) {
        let r = 0,
          g = 0,
          b = 0,
          count = 0;
        const x0 = bx * blockW;
        const y0 = by * blockH;
        const x1 = Math.min(width, (bx + 1) * blockW);
        const y1 = Math.min(height, (by + 1) * blockH);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        if (count > 0) {
          blocks.push({ r: r / count, g: g / count, b: b / count, x: bx, y: by });
        }
      }
    }

    // 找相邻块对比度最小值（疑似对比度不足）
    let minContrast = 21;
    let minPair: { a: typeof blocks[0]; b: typeof blocks[0] } | null = null;
    for (const blk of blocks) {
      const neighbors = blocks.filter(
        (o) => Math.abs(o.x - blk.x) + Math.abs(o.y - blk.y) === 1,
      );
      for (const n of neighbors) {
        const l1 = this.relativeLuminance(blk.r, blk.g, blk.b);
        const l2 = this.relativeLuminance(n.r, n.g, n.b);
        const ratio = this.contrastRatio(l1, l2);
        if (ratio < minContrast) {
          minContrast = ratio;
          minPair = { a: blk, b: n };
        }
      }
    }

    const issues: DiagnosisIssue[] = [];
    if (minContrast < 4.5) {
      issues.push({
        type: 'contrast',
        severity: minContrast < 3 ? 'high' : 'medium',
        description: `检测到相邻区块对比度仅 ${minContrast.toFixed(2)}:1，低于 WCAG AA 4.5:1（位置 x=${minPair?.a.x},y=${minPair?.a.y}）`,
        suggestion: `将文字与背景对比度提升至 ≥ 4.5:1（AAA 推荐 ≥ 7:1）`,
      });
    }
    return issues;
  }

  /** 对齐诊断（降级版：用列投影方差粗略估算） */
  diagnoseAlignment(imgData: ImageData): DiagnosisIssue[] {
    // DOWNGRADE: 原计划 Sobel 边缘 + 列投影方差，这里简化为列方差
    const { data, width, height } = imgData;
    if (width < 4 || height < 4) return [];

    // 计算每列的亮度方差
    const colMeans: number[] = new Array(width).fill(0);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      colMeans[x] = sum / height;
    }
    // 检测列均值的跳变（疑似边缘），看左边缘是否对齐
    const edges: number[] = [];
    for (let x = 1; x < width; x++) {
      if (Math.abs(colMeans[x] - colMeans[x - 1]) > 30) {
        edges.push(x);
      }
    }
    // 简化判断：如果边缘分布跨度 > 4px 视为有错位
    if (edges.length > 4) {
      const minEdge = Math.min(...edges);
      const maxEdge = Math.max(...edges);
      if (maxEdge - minEdge > 4) {
        return [
          {
            type: 'alignment',
            severity: 'medium',
            description: `检测到左边缘分布跨度 ${maxEdge - minEdge}px（> 4px），疑似对齐错位`,
            suggestion: '统一左对齐或网格对齐（8px 网格）',
          },
        ];
      }
    }
    return [];
  }

  /** 间距诊断（降级版） */
  diagnoseSpacing(imgData: ImageData): DiagnosisIssue[] {
    // DOWNGRADE: 原计划水平/垂直空白带聚类 + 变异系数，简化为行方差
    const { data, width, height } = imgData;
    if (width < 4 || height < 4) return [];

    const rowMeans: number[] = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      rowMeans[y] = sum / width;
    }
    // 找空白行（亮度接近背景）
    const bg = rowMeans.reduce((a, b) => a + b, 0) / height;
    const blanks: number[] = [];
    let curRun = 0;
    for (let y = 0; y < height; y++) {
      if (Math.abs(rowMeans[y] - bg) < 10) {
        curRun++;
      } else {
        if (curRun > 0) blanks.push(curRun);
        curRun = 0;
      }
    }
    if (curRun > 0) blanks.push(curRun);

    if (blanks.length < 3) return [];
    const mean = blanks.reduce((a, b) => a + b, 0) / blanks.length;
    const variance = blanks.reduce((a, b) => a + (b - mean) ** 2, 0) / blanks.length;
    const cv = Math.sqrt(variance) / Math.max(mean, 1);
    if (cv > 0.4) {
      return [
        {
          type: 'spacing',
          severity: 'medium',
          description: `间距变异系数 ${cv.toFixed(2)}（> 0.4），间距不统一`,
          suggestion: '统一间距到 8px 网格（8/12/16/24）',
        },
      ];
    }
    return [];
  }

  /** 字号层级诊断（降级版：连通域面积分簇） */
  diagnoseFontsize(imgData: ImageData): DiagnosisIssue[] {
    // DOWNGRADE: 原计划连通域面积分层聚类，简化为亮度跳变密度分簇
    const { data, width, height } = imgData;
    if (width < 4 || height < 4) return [];

    // 把图像分 4 行，统计每行的亮度跳变数（粗略估算文字密度）
    const rowHeight = Math.floor(height / 4);
    const clusters = new Set<string>();
    for (let r = 0; r < 4; r++) {
      let jumps = 0;
      for (let y = r * rowHeight; y < (r + 1) * rowHeight && y < height; y++) {
        for (let x = 1; x < width; x++) {
          const i = (y * width + x) * 4;
          const iPrev = (y * width + (x - 1)) * 4;
          const cur = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const prev = (data[iPrev] + data[iPrev + 1] + data[iPrev + 2]) / 3;
          if (Math.abs(cur - prev) > 40) jumps++;
        }
      }
      // 跳变数粗略对应字号
      clusters.add(jumps > width * 0.5 ? 'large' : jumps > width * 0.2 ? 'medium' : 'small');
    }
    if (clusters.size < 3) {
      return [
        {
          type: 'fontsize',
          severity: 'low',
          description: `字号层级簇数 ${clusters.size}（< 3），层级缺失`,
          suggestion: '建立 ≥ 3 级字号层级（如 H1 24 / H2 18 / 正文 12）',
        },
      ];
    }
    return [];
  }
}

export const screenshotDiagnoser = new ScreenshotDiagnoser();
