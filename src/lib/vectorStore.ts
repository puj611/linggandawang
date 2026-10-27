// src/lib/vectorStore.ts
// RAG-Lite 向量存储：本地嵌入 + 余弦相似度检索
// 使用 @huggingface/transformers 的 all-MiniLM-L6-v2 模型（~90MB，CPU 可跑）
// 用途：将用户历史答案向量化，提问时检索 Top-K 相似历史增强上下文
// Phase C：持久化升级为 SQLite（Tauri）/ localStorage（浏览器降级）

import type { ContextRecentQA } from '@/types/context';
import type { env as transformersEnv, FeatureExtractionPipeline } from '@huggingface/transformers';
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
let embedder: FeatureExtractionPipeline | null = null;
let embedderLoading = false;
let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

// WASM 运行时目录（public/ort/，由 scripts/copy-ort-wasm.mjs 在 prebuild/predev 时生成）
const ORT_WASM_DIR = 'ort/';
// onnxruntime-web 默认构建的 WASM 运行时文件名
const ORT_WASM_BASE = 'ort-wasm-simd-threaded';

/** transformers 的 env 对象类型（TransformersEnvironment 未从包根导出，用 typeof 取） */
type TransformersEnv = typeof transformersEnv;

/**
 * 把 onnxruntime 的 WASM 运行时从 CDN 改成自托管本地路径（生产 CSP 因此无需放行 jsdelivr）。
 * v4 在模块求值时就写入 wasmPaths=https://cdn.jsdelivr.net/npm/onnxruntime-web@<ver>/dist/。
 * env.backends.onnx 是 ONNX_ENV 的浅拷贝，其 .wasm 与 ONNX_ENV.wasm 指向同一对象——
 * 必须原地改 .wasmPaths 字段（整体替换 env.backends.onnx.wasm 不会传导给 onnxruntime），
 * 且在 pipeline() 创建 InferenceSession 之前完成。
 */
function useLocalWasm(tfEnv: TransformersEnv): void {
  const wasm = tfEnv.backends.onnx.wasm;
  if (!wasm) return;
  // base: './' → 以文档目录为基准解析：dev（vite）与生产（tauri://localhost 或 http://tauri.localhost）都成立
  const base = typeof document !== 'undefined' ? document.baseURI : undefined;
  const dir = base ? new URL(ORT_WASM_DIR, base).href : `./${ORT_WASM_DIR}`;
  wasm.wasmPaths = {
    mjs: `${dir}${ORT_WASM_BASE}.mjs`,
    wasm: `${dir}${ORT_WASM_BASE}.wasm`,
  };
  // 关闭 wasm 预缓存：预缓存会把 .mjs 转成 blob: URL 再动态 import，需 CSP 额外放行 script-src blob:；
  // 本地文件加载无网络成本，关掉可保持 CSP 最小化
  tfEnv.useWasmCache = false;
}

/**
 * 获取嵌入模型（懒加载，首次调用时下载模型 ~90MB）
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;
  if (embedderPromise) return embedderPromise;

  embedderLoading = true;
  embedderPromise = (async () => {
    try {
      const { env, pipeline } = await import('@huggingface/transformers');
      useLocalWasm(env);
      const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'q8', // 量化模型，体积更小（v2 的 quantized: true 在 v4 改为 dtype）
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
  const output = await model(text, { pooling: 'mean', normalize: true });
  const data: unknown = output.data;
  // v4 的 Tensor.data 是 DataArray（含 BigInt 视图与普通数组），本 pipeline 固定输出 float32
  if (!(data instanceof Float32Array)) {
    throw new TypeError('[vectorStore] 嵌入输出不是 Float32Array，无法得到 384 维向量');
  }

  return new Float32Array(data);
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
      // SQLite 持久化（审查 P2 修复：staging 表原子替换，杜绝 DELETE 后 INSERT 失败导致数据丢失）
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
      // 1) 全量写入 staging 表：任一批失败直接抛出，原表完好无损
      await executeSql('DROP TABLE IF EXISTS vector_store_staging');
      await executeSql(`
        CREATE TABLE vector_store_staging (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          vector_json TEXT,
          created_at TEXT NOT NULL
        )
      `);
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
          `INSERT INTO vector_store_staging (id, text, metadata_json, vector_json, created_at) VALUES ${placeholders}`,
          params,
        );
      }
      // 2) staging 写满后原子换名：DROP 旧表 + RENAME，期间任何失败 staging 重建即可，原表仍可用
      await executeSql('DROP TABLE IF EXISTS vector_store');
      await executeSql('ALTER TABLE vector_store_staging RENAME TO vector_store');
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
      const { getDb, executeSql } = await import('@/lib/sqlite');
      const db = await getDb();
      if (db) {
        // 审查 P2 补救：上次进程死在 DROP-RENAME 之间（staging 已写满、原表已删）时换名恢复
        try {
          const tbls = await (db as { select: <T>(sql: string, params?: unknown[]) => Promise<T> }).select<Array<{ name: string }>>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('vector_store', 'vector_store_staging')",
          );
          const names = new Set(tbls.map((t) => t.name));
          if (!names.has('vector_store') && names.has('vector_store_staging')) {
            await executeSql('ALTER TABLE vector_store_staging RENAME TO vector_store');
          }
        } catch {
          // 补救失败则走下方正常 SELECT（可能抛 no such table，由外层 catch 兜底）
        }
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
