// src/lib/vectorStore.ts
// RAG-Lite 向量存储：本地嵌入 + 余弦相似度检索
// 使用 @xenova/transformers 的 all-MiniLM-L6-v2 模型（~90MB，CPU 可跑）
// 用途：将用户历史答案向量化，提问时检索 Top-K 相似历史增强上下文
// Phase C：持久化升级为 SQLite（Tauri）/ localStorage（浏览器降级）

import type { ContextRecentQA } from '@/types/context';
import { isTauri } from '@/lib/env';

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

  // 超时保护：embed 首次调用需下载 90MB 模型，网络慢时可能永远 pending
  // 给 5 秒超时，超时后降级返回空结果（不阻塞提示词生成）
  const queryEmbedding = await Promise.race([
    embed(query),
    new Promise<Float32Array>((resolve) => setTimeout(() => resolve(new Float32Array(EMBEDDING_DIM)), 5000)),
  ]);
  // 全零向量（超时降级）时直接返回空，避免无效相似度计算
  if (queryEmbedding.every((v) => v === 0)) return [];

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

// 批量插入每批行数（每行 5 个绑定参数，40 行 = 200 参数，远低于 SQLite 默认 999 上限）
const PERSIST_BATCH_ROWS = 40;

/**
 * 持久化向量存储到 SQLite（Tauri）或 localStorage（浏览器降级）
 * P1：连同向量本体一起持久化（vector_json），恢复时直接复用免重嵌入
 * P2：SQLite 写入改为拼接 VALUES 的批量 INSERT（每批 40 行），替代逐条 INSERT 的 N+1 次调用
 */
export async function persistVectorStore(): Promise<void> {
  try {
    if (isTauri()) {
      // SQLite 持久化
      const { executeSql } = await import('@/lib/sqlite');
      // 创建表（如果不存在，结构与迁移 0005 一致）
      await executeSql(`
        CREATE TABLE IF NOT EXISTS vector_store (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          vector_json TEXT,
          created_at TEXT NOT NULL
        )
      `);
      const now = new Date().toISOString();
      // 全删后批量插入（每批单条语句原子写入，200 条最多 5 次调用，替代原 200 次）
      await executeSql('DELETE FROM vector_store');
      for (let i = 0; i < vectorStore.length; i += PERSIST_BATCH_ROWS) {
        const chunk = vectorStore.slice(i, i + PERSIST_BATCH_ROWS);
        const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const params: unknown[] = [];
        for (const item of chunk) {
          params.push(
            item.id,
            item.text,
            JSON.stringify(item.metadata),
            JSON.stringify(Array.from(item.embedding)),
            now,
          );
        }
        await executeSql(
          `INSERT INTO vector_store (id, text, metadata_json, vector_json, created_at) VALUES ${placeholders}`,
          params,
        );
      }
    } else {
      // 浏览器降级：localStorage（仅元数据，与现有行为一致）
      const data = vectorStore.map((e) => ({
        id: e.id,
        text: e.text,
        metadata: e.metadata,
      }));
      localStorage.setItem('linggan_vector_store', JSON.stringify(data));
    }
  } catch (e) {
    console.warn('[vectorStore] persist 失败', e);
  }
}

// 恢复时分批处理的条数（每批 10 条让出主线程，避免冷启动大量条目卡顿）
const RESTORE_BATCH_SIZE = 10;

/**
 * 从 SQLite（Tauri）或 localStorage（浏览器降级）恢复向量存储
 * P1：优先复用持久化的向量本体（vector_json），仅旧数据（vector 为空/非法）才回退重嵌入
 * 分批恢复（每批 10 条 setTimeout(0) 让出主线程），避免大量条目冷启动卡顿
 */
export async function restoreVectorStore(): Promise<void> {
  try {
    let data: Array<{
      id: string;
      text: string;
      metadata: VectorEntry['metadata'];
      vectorJson?: string | null;
    }> = [];

    if (isTauri()) {
      // SQLite 恢复
      const { getDb } = await import('@/lib/sqlite');
      const db = await getDb();
      if (db) {
        const rows = await (db as { select: <T>(sql: string, params?: unknown[]) => Promise<T> }).select<Array<{ id: string; text: string; metadata_json: string; vector_json: string | null }>>(
          'SELECT id, text, metadata_json, vector_json FROM vector_store ORDER BY created_at'
        );
        data = rows.map((r) => ({
          id: r.id,
          text: r.text,
          metadata: JSON.parse(r.metadata_json),
          vectorJson: r.vector_json,
        }));
      }
    } else {
      // 浏览器降级：localStorage（旧格式，无向量，恢复时重嵌入）
      const raw = localStorage.getItem('linggan_vector_store');
      if (raw) {
        data = JSON.parse(raw);
      }
    }

    if (data.length === 0) return;

    for (let i = 0; i < data.length; i += RESTORE_BATCH_SIZE) {
      const chunk = data.slice(i, i + RESTORE_BATCH_SIZE);
      for (const item of chunk) {
        // P1：优先复用持久化向量，跳过 embed 调用
        let embedding: Float32Array | null = null;
        if (item.vectorJson) {
          try {
            const arr = JSON.parse(item.vectorJson) as number[];
            if (Array.isArray(arr) && arr.length === EMBEDDING_DIM) {
              embedding = new Float32Array(arr);
            }
          } catch {
            // 向量解析失败，回退重嵌入
          }
        }
        if (!embedding) {
          // 旧数据（无持久化向量）回退：重新嵌入
          embedding = await embed(item.text);
        }
        vectorStore.push({
          id: item.id,
          text: item.text,
          embedding,
          metadata: item.metadata,
        });
      }
      // 让出主线程（后续还有批次时）
      if (i + RESTORE_BATCH_SIZE < data.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // 恢复条数超限时裁剪（与 indexQA 的 MAX_ENTRIES 语义一致）
    if (vectorStore.length > MAX_ENTRIES) {
      vectorStore = vectorStore.slice(-MAX_ENTRIES);
    }
  } catch (e) {
    console.warn('[vectorStore] restore 失败', e);
  }
}
