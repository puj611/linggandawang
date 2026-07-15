// src/lib/__tests__/vectorStore.test.ts
import { describe, it, expect, vi } from 'vitest';
import { cosineSimilarity } from '../vectorStore';

// Mock @xenova/transformers（避免测试时下载模型）
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(async (_text: string) => ({
    data: new Float32Array([1, 0, 0, 0]), // 4 维 mock 向量
  })),
}));

describe('vectorStore', () => {
  describe('cosineSimilarity', () => {
    it('相同向量相似度为 1', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
    });

    it('正交向量相似度为 0', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      const b = new Float32Array([0, 1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('反向向量相似度为 -1', () => {
      const a = new Float32Array([1, 0]);
      const b = new Float32Array([-1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it('不同长度向量返回 0', () => {
      const a = new Float32Array([1, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('零向量返回 0', () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });
  });
});
