// src/hooks/__tests__/useVectorStore.test.tsx
// useVectorStore 的初始化与检索链路（RTL）：
//   - 无历史时 ensureInit 不加载模型（空库降级，见 AGENTS 坑点 16）
//   - 有历史时索引并持久化
//   - retrieve 在未就绪 / 空查询 / 检索异常时都安全降级为空数组
// 注意：useVectorStore 的初始化是模块级单例（initPromise / sharedState），
// 测试间必须 resetModules 重新 import，否则后续用例复用上一轮缓存的 promise 会误判。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// contextStore 的可控状态（每轮重置）
const ctxState = {
  recent_qa: [] as Array<{ question_id: string; question_text: string; answer: string; answered_at: string }>,
  preferences: [] as Array<{ key: string; value: string; confirmed_at: string }>,
};

/** 重新 import 被测模块与 mock，拿到全新的模块级单例 */
async function loadHook() {
  vi.resetModules();
  vi.doMock('@/lib/vectorStore', () => ({
    indexQABatch: vi.fn(async () => {}),
    retrieveSimilar: vi.fn(async () => []),
    restoreVectorStore: vi.fn(async () => {}),
    persistVectorStore: vi.fn(async () => {}),
    getVectorStoreStats: vi.fn(() => ({ size: 0, loading: false, dim: 512 })),
    // reindex 内部用动态 import 取它；缺了会让解构出 undefined 并抛错
    clearVectorStore: vi.fn(() => {}),
  }));
  vi.doMock('@/stores/contextStore', () => {
    const state = {
      ctx: ctxState,
      appendRecentQA: vi.fn(),
      appendRecentQAs: vi.fn(),
      getRecentQA: () => ctxState.recent_qa,
      getPreferences: () => ctxState.preferences,
      setIntentTags: vi.fn(),
      setLastPrompt: vi.fn(),
      appendPreferences: vi.fn(),
      clear: vi.fn(),
    };
    const hook = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
    return { useContextStore: Object.assign(hook, { getState: () => ({ ctx: ctxState }) }) };
  });
  const hookMod = await import('../useVectorStore');
  const storeMod = await import('@/lib/vectorStore');
  return { useVectorStore: hookMod.useVectorStore, store: storeMod as unknown as Record<string, ReturnType<typeof vi.fn>> };
}

function resetCtx(): void {
  ctxState.recent_qa = [];
  ctxState.preferences = [];
}

beforeEach(() => {
  resetCtx();
});

describe('useVectorStore', () => {
  it('无历史时不加载模型（空库降级），但 ready 置为 true', async () => {
    const { useVectorStore, store } = await loadHook();
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    // 关键：空历史下不应调用 indexQABatch（避免白下载 95MB 模型）
    expect(store.indexQABatch).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('有历史时调用 indexQABatch 索引', async () => {
    ctxState.recent_qa = [
      { question_id: 'q1', question_text: '问题1', answer: '答案1', answered_at: '2026-10-29T00:00:00Z' },
    ];
    const { useVectorStore, store } = await loadHook();
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(store.indexQABatch).toHaveBeenCalled());
    const arg = (store.indexQABatch.mock.calls[0] as unknown[])[0];
    expect(arg).toEqual(ctxState.recent_qa);
  });

  it('初始化失败时 error 有值且 ready 仍为 true（不阻塞主流程）', async () => {
    const { useVectorStore } = await loadHook();
    const storeMod = await import('@/lib/vectorStore');
    (storeMod.restoreVectorStore as unknown as { mockRejectedValueOnce: (e: Error) => void })
      .mockRejectedValueOnce(new Error('模型下载失败'));
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toContain('模型下载失败');
  });

  it('模块级单例：双挂载只初始化一次', async () => {
    const { useVectorStore, store } = await loadHook();
    renderHook(() => useVectorStore());
    renderHook(() => useVectorStore());
    await waitFor(() => expect(store.restoreVectorStore).toHaveBeenCalledTimes(1));
  });

  it('retrieve 在空查询时返回空数组且不调用底层检索', async () => {
    const { useVectorStore, store } = await loadHook();
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    let out: unknown;
    await act(async () => { out = await result.current.retrieve('   '); });
    expect(out).toEqual([]);
    expect(store.retrieveSimilar).not.toHaveBeenCalled();
  });

  it('retrieve 正常路径把 query 与 topK 透传给 retrieveSimilar', async () => {
    const { useVectorStore, store } = await loadHook();
    const fakeResult = [{ entry: { id: 'a' }, score: 0.9 }];
    store.retrieveSimilar.mockResolvedValueOnce(fakeResult);
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    let out: unknown;
    await act(async () => { out = await result.current.retrieve('查询词', 3); });
    expect(out).toEqual(fakeResult);
    expect(store.retrieveSimilar).toHaveBeenCalledWith('查询词', 3);
  });

  it('retrieve 底层抛错时降级为空数组（不让检索失败打断提问流程）', async () => {
    const { useVectorStore, store } = await loadHook();
    store.retrieveSimilar.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    let out: unknown;
    await act(async () => { out = await result.current.retrieve('查询词'); });
    expect(out).toEqual([]);
  });

  it('reindex 会持久化重建结果', async () => {
    const { useVectorStore, store } = await loadHook();
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    store.persistVectorStore.mockClear();

    await act(async () => { await result.current.reindex(); });
    // reindex 内部对 clearVectorStore / restoreVectorStore 用的是动态 import，
    // 静态 mock 抓不到；但持久化结果（persistVectorStore）是同一模块的静态引用，可断言。
    expect(store.persistVectorStore).toHaveBeenCalled();
  });

  it('size 由 getVectorStoreStats 提供（不在 hook 内硬编码）', async () => {
    const { useVectorStore, store } = await loadHook();
    const { result } = renderHook(() => useVectorStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.size).toBe(0);
    expect(store.getVectorStoreStats).toHaveBeenCalled();
  });
});
