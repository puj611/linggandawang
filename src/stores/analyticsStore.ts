// src/stores/analyticsStore.ts
// 簇命中分析数据：记录每次 start 的簇命中情况，持久化到 localStorage
import { create } from 'zustand';

export type RouteSource = 'keyword' | 'cluster' | 'fallback' | 'llm';

export interface ClusterHitRecord {
  id: string;
  timestamp: string;
  seed: string;
  routeSource: RouteSource;
  matchedKeywords: string[];
  matchedClusterIds: string[];
  matchedClusterForms: string[];
  firstQuestionId: string | null;
  firstQuestionStage: string | null;
  hasDynamicClarification: boolean;
  topTagScores: { tag: string; weight: number }[];
}

interface AnalyticsStore {
  records: ClusterHitRecord[];
  // actions
  recordHit: (record: ClusterHitRecord) => void;
  clearAll: () => void;
  clearBefore: (timestamp: string) => void;
  load: () => void;
}

const STORAGE_KEY = 'linggandawang:cluster_analytics_v1';
const MAX_RECORDS = 500;

function loadFromStorage(): ClusterHitRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function saveToStorage(records: ClusterHitRecord[]) {
  try {
    const trimmed = records.slice(-MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage 满或不可用时忽略
  }
}

export const useAnalyticsStore = create<AnalyticsStore>((set) => ({
  records: [],
  recordHit: (record) => {
    set((st) => {
      const next = [...st.records, record].slice(-MAX_RECORDS);
      saveToStorage(next);
      return { records: next };
    });
  },
  clearAll: () => {
    set({ records: [] });
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  },
  clearBefore: (timestamp) => {
    set((st) => {
      const next = st.records.filter((r) => r.timestamp >= timestamp);
      saveToStorage(next);
      return { records: next };
    });
  },
  load: () => {
    set({ records: loadFromStorage() });
  },
}));

// ─────────── 查询辅助函数 ───────────

export interface ClusterStats {
  clusterId: string;
  hitCount: number;
  lastHitAt: string | null;
}

export interface SourceDistribution {
  keyword: number;
  cluster: number;
  fallback: number;
  llm: number;
}

export interface DateRange {
  label: string; // '7d' | '30d' | 'all' | 'today'
  from: Date | null; // null = 不限制
}

export const DATE_RANGES: Record<string, DateRange> = {
  today: { label: '今天', from: (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })() },
  '7d': { label: '近 7 天', from: (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })() },
  '30d': { label: '近 30 天', from: (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })() },
  all: { label: '全部', from: null },
};

/** 按时间范围过滤记录 */
export function filterByRange(records: ClusterHitRecord[], rangeKey: string): ClusterHitRecord[] {
  const range = DATE_RANGES[rangeKey] ?? DATE_RANGES.all;
  if (!range.from) return records;
  const fromTime = range.from.getTime();
  return records.filter((r) => new Date(r.timestamp).getTime() >= fromTime);
}

/** 计算命中率、总命中数、未命中数 */
export function computeHitRate(records: ClusterHitRecord[]): {
  total: number;
  hitCount: number; // keyword 或 cluster 命中
  missCount: number; // fallback
  hitRate: number;
} {
  const total = records.length;
  const hitCount = records.filter((r) => r.routeSource !== 'fallback').length;
  const missCount = total - hitCount;
  const hitRate = total === 0 ? 0 : hitCount / total;
  return { total, hitCount, missCount, hitRate };
}

/** 计算来源分布 */
export function computeSourceDistribution(records: ClusterHitRecord[]): SourceDistribution {
  return records.reduce<SourceDistribution>(
    (acc, r) => {
      acc[r.routeSource] = (acc[r.routeSource] ?? 0) + 1;
      return acc;
    },
    { keyword: 0, cluster: 0, fallback: 0, llm: 0 },
  );
}

/** 计算每个簇的命中次数和最近命中时间 */
export function computeClusterStats(records: ClusterHitRecord[]): ClusterStats[] {
  const map = new Map<string, ClusterStats>();
  for (const r of records) {
    for (const cid of r.matchedClusterIds) {
      const existing = map.get(cid);
      if (existing) {
        existing.hitCount += 1;
        if (!existing.lastHitAt || r.timestamp > existing.lastHitAt) {
          existing.lastHitAt = r.timestamp;
        }
      } else {
        map.set(cid, { clusterId: cid, hitCount: 1, lastHitAt: r.timestamp });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.hitCount - a.hitCount);
}

/** 按日聚合（用于趋势图） */
export function computeDailyHits(records: ClusterHitRecord[]): { date: string; total: number; hit: number; miss: number }[] {
  const map = new Map<string, { total: number; hit: number; miss: number }>();
  for (const r of records) {
    const date = r.timestamp.slice(0, 10); // YYYY-MM-DD
    const entry = map.get(date) ?? { total: 0, hit: 0, miss: 0 };
    entry.total += 1;
    if (r.routeSource === 'fallback') entry.miss += 1;
    else entry.hit += 1;
    map.set(date, entry);
  }
  return Array.from(map.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
