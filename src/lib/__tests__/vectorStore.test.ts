// src/lib/__tests__/vectorStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cosineSimilarity, indexQA, clearVectorStore, retrieveSimilar } from '../vectorStore';

// Mock @huggingface/transformers（避免测试时下载模型）
// 按文本返回预设向量：测试通过 mockVectors 映射控制每条文本的嵌入结果
const mockVectors = new Map<string, number[]>();
const DEFAULT_VECTOR = [1, 0, 0, 0];

vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } }, useWasmCache: true },
  pipeline: vi.fn().mockResolvedValue(async (text: string) => ({
    data: new Float32Array(mockVectors.get(text) ?? DEFAULT_VECTOR),
  })),
}));

function setVector(text: string, v: number[]): void {
  mockVectors.set(text, v);
}

/** 构造与 [1,0,0,0] 相似度为 s 的单位向量（同平面、夹角 arccos(s)） */
function vecAtSimilarity(s: number): number[] {
  return [s, Math.sqrt(Math.max(0, 1 - s * s)), 0, 0];
}

function qa(id: string, q: string, a: string) {
  return {
    question_id: id,
    question_text: q,
    answer: a,
    answered_at: '2026-10-29T00:00:00.000Z',
  };
}

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

  // 2026-10-29 新增：双闸门检索（绝对下限 + 相对带宽）回归
  // 标定来源：20 条真实 QA + 20 条无关查询，bge-small-zh-v1.5，floor=0.45 band=0.85
  describe('retrieveSimilar 双闸门', () => {
    beforeEach(() => {
      clearVectorStore();
      mockVectors.clear();
    });

    it('无索引数据时返回空', async () => {
      expect(await retrieveSimilar('任意查询')).toEqual([]);
    });

    it('top1 低于绝对下限（0.45）时返回空——无关查询不误命中', async () => {
      // 索引两条，与查询相似度分别为 0.40 / 0.20，都低于 floor=0.45
      setVector('q-a → ans-a', vecAtSimilarity(0.4));
      await indexQA(qa('a', 'q-a', 'ans-a'));
      setVector('q-b → ans-b', vecAtSimilarity(0.2));
      await indexQA(qa('b', 'q-b', 'ans-b'));

      setVector('query', [1, 0, 0, 0]);
      expect(await retrieveSimilar('query')).toEqual([]);
    });

    it('top1 达标时按相对带宽裁掉低分陪衬', async () => {
      // 相似度 0.9 / 0.8 / 0.5；band=0.85 → 门槛 = 0.9*0.85 = 0.765 → 只留 0.9 与 0.8
      setVector('q-hi → ans-hi', vecAtSimilarity(0.9));
      await indexQA(qa('hi', 'q-hi', 'ans-hi'));
      setVector('q-mid → ans-mid', vecAtSimilarity(0.8));
      await indexQA(qa('mid', 'q-mid', 'ans-mid'));
      setVector('q-low → ans-low', vecAtSimilarity(0.5));
      await indexQA(qa('low', 'q-low', 'ans-low'));

      setVector('query', [1, 0, 0, 0]);
      const res = await retrieveSimilar('query', 5);
      const ids = res.map((r) => r.entry.id);
      expect(ids).toEqual(['hi', 'mid']);
      expect(ids).not.toContain('low');
    });

    it('结果按分数降序且不超过 topK', async () => {
      setVector('q1 → a1', vecAtSimilarity(0.95));
      await indexQA(qa('s1', 'q1', 'a1'));
      setVector('q2 → a2', vecAtSimilarity(0.93));
      await indexQA(qa('s2', 'q2', 'a2'));
      setVector('q3 → a3', vecAtSimilarity(0.91));
      await indexQA(qa('s3', 'q3', 'a3'));

      setVector('query', [1, 0, 0, 0]);
      const res = await retrieveSimilar('query', 2);
      expect(res.length).toBeLessThanOrEqual(2);
      for (let i = 1; i < res.length; i++) {
        expect(res[i - 1].score).toBeGreaterThanOrEqual(res[i].score);
      }
    });

    it('空查询返回空', async () => {
      setVector('q-x → ans-x', vecAtSimilarity(0.9));
      await indexQA(qa('x', 'q-x', 'ans-x'));
      setVector('   ', [1, 0, 0, 0]);
      expect(await retrieveSimilar('   ')).toEqual([]);
    });
  });
});
