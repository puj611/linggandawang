// src/lib/__tests__/comparisonStore.test.ts
// R04：comparisonStore 单测——覆盖 SQLite 路径（mock @/lib/sqlite + 内存假 db）
// 与 localStorage 降级路径（jsdom 原生 localStorage，getDb 返回 null）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  deleteComparisonRun,
  getComparisonRunById,
  listComparisonRuns,
  renameComparisonRun,
  saveComparisonRun,
  type ComparisonRunRecord,
} from '../comparisonStore';

const LS_KEY = 'sqlite_comparison_runs';

// 共享可变状态（vi.hoisted 保证先于 vi.mock 工厂执行）
const state = vi.hoisted(() => ({
  useSqlite: false,
  rows: [] as Array<Record<string, unknown>>,
  executed: [] as Array<{ sql: string; params: unknown[] }>,
  nextId: 1,
}));

// Mock @/lib/sqlite：useSqlite=true 时返回内存假 db（execute/select 记录 SQL 并维护行），
// false 时返回 null（触发 localStorage 降级路径，与真实 getDb 的浏览器行为一致）
vi.mock('@/lib/sqlite', () => {
  const db = {
    execute: async (sql: string, params: unknown[] = []) => {
      state.executed.push({ sql, params });
      if (/INSERT INTO comparison_runs/i.test(sql)) {
        const row = {
          id: state.nextId,
          name: params[0],
          left_json: params[1],
          right_json: params[2],
          diff_json: params[3],
          created_at: params[4],
          updated_at: params[5],
        };
        state.nextId += 1;
        state.rows.push(row);
        return { lastInsertId: row.id };
      }
      if (/UPDATE comparison_runs/i.test(sql)) {
        const row = state.rows.find((r) => r.id === params[2]);
        if (row) {
          row.name = params[0];
          row.updated_at = params[1];
        }
        return {};
      }
      if (/DELETE FROM comparison_runs/i.test(sql)) {
        const idx = state.rows.findIndex((r) => r.id === params[0]);
        if (idx >= 0) state.rows.splice(idx, 1);
        return {};
      }
      return {};
    },
    select: async <T>(sql: string, params: unknown[] = []): Promise<T> => {
      if (/WHERE id =/i.test(sql)) {
        return state.rows.filter((r) => r.id === params[0]) as unknown as T;
      }
      const limit = typeof params[0] === 'number' ? (params[0] as number) : state.rows.length;
      return [...state.rows]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, limit) as unknown as T;
    },
  };
  return { getDb: async () => (state.useSqlite ? db : null) };
});

function makeInput(name = '测试对比') {
  return {
    name,
    left_json: '{"left":true}',
    right_json: '{"right":true}',
    diff_json: '{"summary":{}}',
  };
}

describe('comparisonStore · SQLite 路径', () => {
  beforeEach(() => {
    state.useSqlite = true;
    state.rows = [];
    state.executed = [];
    state.nextId = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saveComparisonRun 写入并返回 lastInsertId，且先执行建表/建索引兜底', async () => {
    const id = await saveComparisonRun(makeInput());
    expect(id).toBe(1);
    const sqls = state.executed.map((e) => e.sql);
    expect(sqls.some((s) => /CREATE TABLE IF NOT EXISTS comparison_runs/i.test(s))).toBe(true);
    expect(
      sqls.some((s) => /CREATE INDEX IF NOT EXISTS idx_comparison_runs_created_at/i.test(s)),
    ).toBe(true);
    expect(sqls.some((s) => /INSERT INTO comparison_runs/i.test(s))).toBe(true);
    const insert = state.executed.find((e) => /INSERT INTO comparison_runs/i.test(e.sql));
    expect(insert?.params?.[0]).toBe('测试对比');
    expect(state.rows).toHaveLength(1);
  });

  it('空白名称归一为「未命名对比」', async () => {
    await saveComparisonRun(makeInput('   '));
    expect(state.rows[0].name).toBe('未命名对比');
  });

  it('listComparisonRuns 按创建时间倒序返回', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T10:00:00.000Z'));
    await saveComparisonRun(makeInput('第一版'));
    vi.setSystemTime(new Date('2026-10-24T11:00:00.000Z'));
    await saveComparisonRun(makeInput('第二版'));
    const rows = await listComparisonRuns(20);
    expect(rows.map((r) => r.name)).toEqual(['第二版', '第一版']);
    expect(rows.every((r) => typeof r.id === 'number')).toBe(true);
  });

  it('listComparisonRuns 遵守 limit', async () => {
    await saveComparisonRun(makeInput('A'));
    await saveComparisonRun(makeInput('B'));
    const rows = await listComparisonRuns(1);
    expect(rows).toHaveLength(1);
  });

  it('getComparisonRunById 命中与未命中', async () => {
    const id = await saveComparisonRun(makeInput());
    const hit = await getComparisonRunById(id);
    expect(hit?.name).toBe('测试对比');
    expect(hit?.left_json).toBe('{"left":true}');
    expect(await getComparisonRunById(9999)).toBeNull();
  });

  it('renameComparisonRun 更新名称与 updated_at', async () => {
    const id = await saveComparisonRun(makeInput());
    await renameComparisonRun(id, '重命名后的对比');
    const row = await getComparisonRunById(id);
    expect(row?.name).toBe('重命名后的对比');
    expect(typeof row?.updated_at).toBe('string');
    expect(state.executed.some((e) => /UPDATE comparison_runs/i.test(e.sql))).toBe(true);
  });

  it('deleteComparisonRun 删除记录', async () => {
    const id = await saveComparisonRun(makeInput());
    await deleteComparisonRun(id);
    expect(await getComparisonRunById(id)).toBeNull();
    expect(state.executed.some((e) => /DELETE FROM comparison_runs/i.test(e.sql))).toBe(true);
  });
});

describe('comparisonStore · localStorage 降级路径', () => {
  beforeEach(() => {
    state.useSqlite = false;
    state.executed = [];
    localStorage.removeItem(LS_KEY);
  });

  it('save → list → getById → rename → delete 全链路', async () => {
    const id = await saveComparisonRun(makeInput());
    expect(id).toBeGreaterThan(0);

    const rows = await listComparisonRuns(20);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('测试对比');

    const hit = await getComparisonRunById(id);
    expect(hit?.right_json).toBe('{"right":true}');

    await renameComparisonRun(id, '改名');
    expect((await getComparisonRunById(id))?.name).toBe('改名');

    await deleteComparisonRun(id);
    expect(await listComparisonRuns(20)).toHaveLength(0);
    expect(await getComparisonRunById(id)).toBeNull();
  });

  it('新记录排在列表最前（unshift 语义）', async () => {
    const first = await saveComparisonRun(makeInput('旧记录'));
    await new Promise((r) => setTimeout(r, 2));
    const second = await saveComparisonRun(makeInput('新记录'));
    const rows: ComparisonRunRecord[] = await listComparisonRuns(20);
    expect(rows.map((r) => r.id)).toEqual([second, first]);
  });

  it('localStorage 数据损坏时 list 返回空数组', async () => {
    localStorage.setItem(LS_KEY, 'not-json');
    expect(await listComparisonRuns(20)).toEqual([]);
  });

  it('超出上限时裁剪到 100 条', async () => {
    for (let i = 0; i < 105; i++) {
      await saveComparisonRun(makeInput(`记录-${i}`));
    }
    const rows = await listComparisonRuns(200);
    expect(rows).toHaveLength(100);
  });
});
