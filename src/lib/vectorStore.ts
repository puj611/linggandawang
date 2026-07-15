// src/lib/vectorStore.ts
// RAG-Lite 向量存储：本地嵌入 + 余弦相似度检索
// 使用 @xenova/transformers 的 all-MiniLM-L6-v2 模型（~90MB，CPU 可跑）
// 用途：将用户历史答案向量化，提问时检索 Top-K 相似历史增强上下文

import type { ContextRecentQA } from '@/types/context';

// 嵌入维度（all-MiniLM-L6-v2 输出 384 维）
const EMBEDDING_DIM = 384;
// 最大历史条数
const MAX_ENTRIES = 200;
// 检索返回条数
const DEFAULT_TOP_K = 5;
// 相似度阈值（低于此值不返回）
const SIMILARITY_THRESHOLD = 0.3;

// 嵌入模型单例
let embedder: unknown = null;
let embedderLoading = false;
let embedderPromise: Promise<unknown> | null = null;

/**
 * 获取嵌入模型（懒加载，首次调用时下载模型 ~90MB）
 */
async function getEmbedder(): Promise<unknown> {
  if (embedder) return embedder;
  if (embedderPromise) return embedderPromise;

  embedderLoading = true;
  embedderPromise = (async () => {
    try {
      const { pipeline } = await import('@xenova/transformers');
      const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true, // 使用量化模型，体积更小
      });
      embedder = model;
      embedderLoading = false;
      return model;
    } catch (e) {
      embedderLoading = false;
      embedderPromise = null;
      throw e;
    }
  })();

  return embedderPromise;
}

/**
 * 将文本转换为向量（384 维）
 */
export async function embed(text: string): Promise<Float32Array> {
  if (!text || text.trim().length === 0) {
    return new Float32Array(EMBEDDING_DIM);
  }

  const model = await getEmbedder();
  const result = await (model as (text: string, options: unknown) => Promise<{ data: Float32Array }>)(text, {
    pooling: 'mean',
    normalize: true,
  });

  return new Float32Array(result.data);
}

/**
 * 计算两个向量的余弦相似度
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** 向量存储条目 */
export interface VectorEntry {
  id: string;
  text: string;
  embedding: Float32Array;
  metadata: {
    questionId: string;
    questionText: string;
    answer: string;
    answeredAt: string;
  };
}

/** 检索结果 */
export interface RetrievalResult {
  entry: VectorEntry;
  score: number;
}

// 内存向量存储（可持久化到 localStorage）
let vectorStore: VectorEntry[] = [];

/**
 * 索引一条 QA 到向量存储
 */
export async function indexQA(qa: ContextRecentQA): Promise<void> {
  if (!qa.answer || qa.answer === '__skipped__') return;

  const text = `${qa.question_text} → ${qa.answer}`;
  const embedding = await embed(text);

  // 检查是否已存在（避免重复索引）
  const existingIdx = vectorStore.findIndex((e) => e.id === qa.question_id);
  const entry: VectorEntry = {
    id: qa.question_id,
    text,
    embedding,
    metadata: {
      questionId: qa.question_id,
      questionText: qa.question_text,
      answer: qa.answer,
      answeredAt: qa.answered_at,
    },
  };

  if (existingIdx >= 0) {
    vectorStore[existingIdx] = entry;
  } else {
    vectorStore.push(entry);
  }

  // 超限时裁剪（移除最旧的）
  if (vectorStore.length > MAX_ENTRIES) {
    vectorStore = vectorStore.slice(-MAX_ENTRIES);
  }
}

/**
 * 批量索引 QA 列表
 */
export async function indexQABatch(qas: ContextRecentQA[]): Promise<void> {
  for (const qa of qas) {
    await indexQA(qa);
  }
}

/**
 * 检索与查询最相似的历史 QA
 */
export async function retrieveSimilar(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievalResult[]> {
  if (vectorStore.length === 0 || !query.trim()) return [];

  const queryEmbedding = await embed(query);

  const scored = vectorStore.map((entry) => ({
    entry,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  return scored
    .filter((s) => s.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * 清空向量存储
 */
export function clearVectorStore(): void {
  vectorStore = [];
}

/**
 * 获取向量存储状态
 */
export function getVectorStoreStats(): {
  size: number;
  loading: boolean;
  dim: number;
} {
  return {
    size: vectorStore.length,
    loading: embedderLoading,
    dim: EMBEDDING_DIM,
  };
}

/**
 * 持久化向量存储到 localStorage（仅元数据，不含向量）
 */
export function persistVectorStore(): void {
  try {
    const data = vectorStore.map((e) => ({
      id: e.id,
      text: e.text,
      metadata: e.metadata,
    }));
    localStorage.setItem('linggan_vector_store', JSON.stringify(data));
  } catch (e) {
    console.warn('[vectorStore] persist 失败', e);
  }
}

/**
 * 从 localStorage 恢复向量存储（需要重新嵌入）
 */
export async function restoreVectorStore(): Promise<void> {
  try {
    const raw = localStorage.getItem('linggan_vector_store');
    if (!raw) return;
    const data = JSON.parse(raw) as Array<{
      id: string;
      text: string;
      metadata: VectorEntry['metadata'];
    }>;

    // 重新嵌入（模型已缓存时很快）
    for (const item of data) {
      const embedding = await embed(item.text);
      vectorStore.push({
        id: item.id,
        text: item.text,
        embedding,
        metadata: item.metadata,
      });
    }
  } catch (e) {
    console.warn('[vectorStore] restore 失败', e);
  }
}
