// src/hooks/useVectorStore.ts
// RAG 向量检索 hook：管理向量存储生命周期 + 提供检索接口
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContextStore } from '@/stores/contextStore';
import {
  indexQABatch,
  retrieveSimilar,
  restoreVectorStore,
  persistVectorStore,
  getVectorStoreStats,
  type RetrievalResult,
} from '@/lib/vectorStore';

interface UseVectorStoreReturn {
  /** 是否已就绪（模型加载完成 + 索引完成） */
  ready: boolean;
  /** 模型加载中 */
  loading: boolean;
  /** 向量存储中的条目数 */
  size: number;
  /** 检索与查询相似的历史 QA */
  retrieve: (query: string, topK?: number) => Promise<RetrievalResult[]>;
  /** 重新索引（如历史数据变化后调用） */
  reindex: () => Promise<void>;
  /** 错误信息 */
  error: string | null;
}

export function useVectorStore(): UseVectorStoreReturn {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const recentQA = useContextStore((s) => s.ctx.recent_qa ?? []);

  // 初始化：恢复向量存储 + 索引当前历史
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 恢复已持久化的向量
        await restoreVectorStore();
        // 索引当前历史
        if (recentQA.length > 0) {
          await indexQABatch(recentQA);
        }
        const stats = getVectorStoreStats();
        setSize(stats.size);
        setReady(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[useVectorStore] 初始化失败', msg);
        setError(msg);
        // 初始化失败不阻塞主流程
        setReady(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 当历史数据变化时增量索引
  useEffect(() => {
    if (!ready || recentQA.length === 0) return;
    (async () => {
      try {
        await indexQABatch(recentQA);
        const stats = getVectorStoreStats();
        setSize(stats.size);
      } catch (e) {
        console.warn('[useVectorStore] 增量索引失败', e);
      }
    })();
  }, [recentQA, ready]);

  // 检索
  const retrieve = useCallback(
    async (query: string, topK?: number): Promise<RetrievalResult[]> => {
      if (!ready || !query.trim()) return [];
      try {
        return await retrieveSimilar(query, topK);
      } catch (e) {
        console.warn('[useVectorStore] 检索失败', e);
        return [];
      }
    },
    [ready],
  );

  // 重新索引
  const reindex = useCallback(async () => {
    setLoading(true);
    try {
      // 清空后重建
      const { clearVectorStore } = await import('@/lib/vectorStore');
      clearVectorStore();
      await restoreVectorStore();
      if (recentQA.length > 0) {
        await indexQABatch(recentQA);
      }
      const stats = getVectorStoreStats();
      setSize(stats.size);
      // 持久化
      persistVectorStore();
    } catch (e) {
      console.warn('[useVectorStore] 重新索引失败', e);
    } finally {
      setLoading(false);
    }
  }, [recentQA]);

  return { ready, loading, size, retrieve, reindex, error };
}
