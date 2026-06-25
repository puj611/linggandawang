// src/stores/contextStore.ts
// 上下文暂存：通过 Tauri invoke 写入 ~/.linggandawang/context.json
import { create } from 'zustand';
import { isTauri } from '@/lib/env';
import type { LinggandawangContext, ContextRecentQA } from '@/types/context';
import type { IntentTag } from '@/types/intent-tag';

const MAX_RECENT_QA = 3;
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
}));
