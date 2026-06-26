// src/stores/contextStore.ts
// 上下文暂存：通过 Tauri invoke 写入 ~/.linggandawang/context.json
import { create } from 'zustand';
import { isTauri } from '@/lib/env';
import type { LinggandawangContext, ContextRecentQA, ContextPreference } from '@/types/context';
import type { IntentTag } from '@/types/intent-tag';

// v2.0：从 3 扩展到 20，使上下文能覆盖完整一次提问流程，喂给 LLM 提供连续性
const MAX_RECENT_QA = 20;
// preferences 累积上限，避免无限膨胀
const MAX_PREFERENCES = 30;
const ARCHIVE_TTL_MS = 24 * 60 * 60 * 1000;

async function getInvoke() {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke;
  } catch {
    return null;
  }
}

function emptyContext(): LinggandawangContext {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0',
    project: undefined,
    current_pain_point: undefined,
    preferences: [],
    recent_qa: [],
    intent_tags: [],
    last_prompt: '',
    timestamps: { created_at: now, updated_at: now },
    archived: false,
  };
}

async function readPersisted(): Promise<LinggandawangContext> {
  const invoke = await getInvoke();
  if (!invoke) return emptyContext();
  try {
    const raw = (await invoke<string>('load_context')) ?? '';
    if (raw) {
      const ctx = JSON.parse(raw) as LinggandawangContext;
      if (ctx && ctx.schema_version === '1.0') return ctx;
    }
  } catch {
    /* noop */
  }
  return emptyContext();
}

async function writePersisted(ctx: LinggandawangContext) {
  const invoke = await getInvoke();
  if (!invoke) return;
  try {
    await invoke('save_context', { payload: { content: JSON.stringify(ctx) } });
  } catch {
    /* noop */
  }
}

async function archiveCtx(_ctx: LinggandawangContext): Promise<LinggandawangContext> {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      await invoke('archive_context');
    } catch {
      /* noop */
    }
  }
  const fresh = emptyContext();
  fresh.timestamps.archived_at = new Date().toISOString();
  await writePersisted(fresh);
  return fresh;
}

interface ContextStoreState {
  ctx: LinggandawangContext;
  loaded: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<LinggandawangContext>) => Promise<void>;
  archiveIfStale: () => Promise<boolean>;
  clear: () => Promise<void>;
  appendRecentQA: (qa: ContextRecentQA) => Promise<void>;
  setIntentTags: (tags: IntentTag[]) => Promise<void>;
  setLastPrompt: (md: string) => Promise<void>;
  setDevProgress: (patch: NonNullable<LinggandawangContext['dev_progress']>) => Promise<void>;
  /** v2.0 新增：累积用户偏好（同 key 同 value 更新时间戳；同 key 不同 value 视为新偏好） */
  appendPreference: (pref: ContextPreference) => Promise<void>;
  /** v2.0 新增：批量累积用户偏好（如从 LLM 分析结果转换） */
  appendPreferences: (prefs: ContextPreference[]) => Promise<void>;
  /** v2.0 新增：便捷读取最近 N 条 QA（用于喂给 LLM / PromptGenerator） */
  getRecentQA: (limit?: number) => ContextRecentQA[];
  /** v2.0 新增：便捷读取用户偏好列表 */
  getPreferences: () => ContextPreference[];
}

export const useContextStore = create<ContextStoreState>((set, get) => ({
  ctx: emptyContext(),
  loaded: false,
  load: async () => {
    const ctx = await readPersisted();
    set({ ctx, loaded: true });
  },
  save: async (patch) => {
    const cur = get().ctx;
    const next: LinggandawangContext = {
      ...cur,
      ...patch,
      timestamps: { ...cur.timestamps, updated_at: new Date().toISOString() },
    };
    await writePersisted(next);
    set({ ctx: next });
  },
  archiveIfStale: async () => {
    const cur = get().ctx;
    const updated = new Date(cur.timestamps.updated_at).getTime();
    if (Date.now() - updated > ARCHIVE_TTL_MS) {
      const fresh = await archiveCtx(cur);
      set({ ctx: fresh });
      return true;
    }
    return false;
  },
  clear: async () => {
    const fresh = emptyContext();
    await writePersisted(fresh);
    set({ ctx: fresh });
  },
  appendRecentQA: async (qa) => {
    const cur = get().ctx;
    const list = [...(cur.recent_qa ?? []), qa].slice(-MAX_RECENT_QA);
    await get().save({ recent_qa: list });
  },
  setIntentTags: async (tags) => {
    await get().save({ intent_tags: tags });
  },
  setLastPrompt: async (md) => {
    await get().save({ last_prompt: md });
  },
  setDevProgress: async (patch) => {
    const cur = get().ctx;
    await get().save({ dev_progress: { ...cur.dev_progress, ...patch } });
  },
  // v2.0 新增：累积用户偏好。同 key 同 value → 仅更新 confirmed_at；同 key 不同 value → 视为偏好升级，保留最新
  appendPreference: async (pref) => {
    const cur = get().ctx;
    const existing = cur.preferences ?? [];
    // 同 key 同 value 视为同一偏好，更新时间戳
    const sameIdx = existing.findIndex((p) => p.key === pref.key && p.value === pref.value);
    let next: ContextPreference[];
    if (sameIdx >= 0) {
      next = existing.map((p, i) => (i === sameIdx ? { ...p, confirmed_at: pref.confirmed_at } : p));
    } else {
      // 同 key 不同 value：移除旧的，追加新的（视为偏好升级）
      const filtered = existing.filter((p) => p.key !== pref.key);
      next = [...filtered, pref].slice(-MAX_PREFERENCES);
    }
    await get().save({ preferences: next });
  },
  appendPreferences: async (prefs) => {
    if (prefs.length === 0) return;
    const cur = get().ctx;
    let existing = [...(cur.preferences ?? [])];
    for (const pref of prefs) {
      const sameIdx = existing.findIndex((p) => p.key === pref.key && p.value === pref.value);
      if (sameIdx >= 0) {
        existing = existing.map((p, i) => (i === sameIdx ? { ...p, confirmed_at: pref.confirmed_at } : p));
      } else {
        const filtered = existing.filter((p) => p.key !== pref.key);
        existing = [...filtered, pref];
      }
    }
    await get().save({ preferences: existing.slice(-MAX_PREFERENCES) });
  },
  getRecentQA: (limit) => {
    const list = get().ctx.recent_qa ?? [];
    return typeof limit === 'number' ? list.slice(-limit) : list;
  },
  getPreferences: () => {
    return get().ctx.preferences ?? [];
  },
}));
