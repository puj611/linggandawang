// src/hooks/useVectorStore.ts
// RAG 向量检索 hook：管理向量存储生命周期 + 提供检索接口
// Task 10（C2）：模块级单例守卫，App 顶层与 SettingsPanel 双挂载共享同一初始化 Promise/状态，
// 不重复初始化；增量索引经模块级去抖合并，多实例多次触发只落一次索引+持久化
import { useCallback, useEffect, useSyncExternalStore } from 'react';
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
  /** 是否已就绪（初始化完成，含降级成功） */
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

// =============== 模块级共享状态（多实例共享） ===============

interface VectorStoreState {
  ready: boolean;
  loading: boolean;
  size: number;
  error: string | null;
}

let sharedState: VectorStoreState = { ready: false, loading: false, size: 0, error: null };
const listeners = new Set<() => void>();

function updateState(patch: Partial<VectorStoreState>): void {
  sharedState = { ...sharedState, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// =============== 初始化单例（App 与 SettingsPanel 共享） ===============

let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    updateState({ loading: true, error: null });
    try {
      // 恢复已持久化的向量（P1：优先复用持久化向量，异步后台进行，不阻塞 UI）
      await restoreVectorStore();
      // 索引当前历史（从 store 取最新值，避免闭包过期）
      const recentQA = useContextStore.getState().ctx.recent_qa ?? [];
      if (recentQA.length > 0) {
        await indexQABatch(recentQA);
      }
      updateState({ size: getVectorStoreStats().size, ready: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[useVectorStore] 初始化失败', msg);
      updateState({ error: msg, ready: true });
      // 初始化失败不阻塞主流程
    } finally {
      updateState({ loading: false });
    }
  })();
  return initPromise;
}

// =============== 增量索引（模块级去抖，多实例合并） ===============

let incrementalTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIncrementalIndex(): void {
  if (incrementalTimer) clearTimeout(incrementalTimer);
  incrementalTimer = setTimeout(async () => {
    incrementalTimer = null;
    try {
      const recentQA = useContextStore.getState().ctx.recent_qa ?? [];
      if (recentQA.length > 0) {
        await indexQABatch(recentQA);
      }
      updateState({ size: getVectorStoreStats().size });
      // 增量索引后持久化
      await persistVectorStore();
    } catch (e) {
      console.warn('[useVectorStore] 增量索引失败', e);
    }
  }, 500);
}

export function useVectorStore(): UseVectorStoreReturn {
  const state = useSyncExternalStore(subscribe, () => sharedState);

  // 初始化（模块级单例：双挂载只跑一次，异步后台进行，失败仅记录状态不影响 UI）
  useEffect(() => {
    void ensureInit();
  }, []);

  // 当历史数据变化时增量索引（去抖合并，多实例共享）
  const recentQA = useContextStore((s) => s.ctx.recent_qa ?? []);
  useEffect(() => {
    if (!state.ready || recentQA.length === 0) return;
    scheduleIncrementalIndex();
  }, [recentQA, state.ready]);

  // 检索
  const retrieve = useCallback(
    async (query: string, topK?: number): Promise<RetrievalResult[]> => {
      if (!state.ready || !query.trim()) return [];
      try {
        return await retrieveSimilar(query, topK);
      } catch (e) {
        console.warn('[useVectorStore] 检索失败', e);
        return [];
      }
    },
    [state.ready],
  );

  // 重新索引
  const reindex = useCallback(async () => {
    updateState({ loading: true });
    try {
      // 清空后重建
      const { clearVectorStore } = await import('@/lib/vectorStore');
      clearVectorStore();
      await restoreVectorStore();
      const recentQA = useContextStore.getState().ctx.recent_qa ?? [];
      if (recentQA.length > 0) {
        await indexQABatch(recentQA);
      }
      updateState({ size: getVectorStoreStats().size });
      // 持久化（异步）
      await persistVectorStore();
    } catch (e) {
      console.warn('[useVectorStore] 重新索引失败', e);
    } finally {
      updateState({ loading: false });
    }
  }, []);

  return { ready: state.ready, loading: state.loading, size: state.size, retrieve, reindex, error: state.error };
}
