// src/lib/__tests__/templateStore.test.ts
// R05：templateStore 单测——SQLite 路径（mock @/lib/sqlite + 内存假 db）
// 与 localStorage 降级路径（jsdom 原生 localStorage，getDb 返回 null）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveTemplate, listTemplates, deleteTemplate } from '../templateStore';

const LS_KEY = 'sqlite_templates';

const state = vi.hoisted(() => ({
  useSqlite: false,
  rows: [] as Array<Record<string, unknown>>,
  executed: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock('@/lib/sqlite', () => {
  const db = {
    execute: async (sql: string, params: unknown[] = []) => {
      state.executed.push({ sql, params });
      if (/INSERT INTO templates/i.test(sql)) {
        const row = {
          id: params[0],
          name: params[1],
          body: params[2],
          tags: params[3],
          created_at: params[4],
          updated_at: params[5],
        };
        const idx = state.rows.findIndex((r) => r.id === row.id);
        if (idx >= 0) {
          // ON CONFLICT(id) DO UPDATE 语义：覆盖除 created_at 外的字段
          state.rows[idx] = { ...state.rows[idx], ...row, created_at: state.rows[idx].created_at };
        } else {
          state.rows.push(row);
        }
        return {};
      }
      if (/DELETE FROM templates/i.test(sql)) {
        const before = state.rows.length;
        state.rows = state.rows.filter((r) => r.id !== params[0]);
        return { rowsAffected: before - state.rows.length };
      }
      return {};
    },
    select: async <T,>(sql: string) => {
      if (/FROM templates ORDER BY/i.test(sql)) {
        return [...state.rows].sort((a, b) =>
          String(a.updated_at) < String(b.updated_at) ? 1 : -1,
        ) as T;
      }
      return [] as T;
    },
  };
  return { getDb: async () => (state.useSqlite ? db : null) };
});

describe('templateStore（localStorage 降级路径）', () => {
  beforeEach(() => {
    localStorage.clear();
    state.useSqlite = false;
    state.rows = [];
    state.executed = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('保存→列表→删除 全链路，updated_at 倒序', async () => {
    await saveTemplate({ name: '间距模板', body: '{{target}} 间距 {{间距}}', tags: '["UI"]' });
    await new Promise((r) => setTimeout(r, 2));
    await saveTemplate({ name: '配色模板', body: '{{颜色}}', tags: '[]' });
    let list = await listTemplates();
    expect(list).toHaveLength(2);
    // 后保存的在前
    expect(list[0].name).toBe('配色模板');
    expect(list[1].body).toContain('{{间距}}');

    const ok = await deleteTemplate(list[0].id);
    expect(ok).toBe(true);
    list = await listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('间距模板');
  });

  it('空名兜底为未命名模板，非法 tags JSON 归一为 []', async () => {
    await saveTemplate({ name: '   ', body: 'x', tags: 'not-json' });
    const [row] = await listTemplates();
    expect(row.name).toBe('未命名模板');
    expect(JSON.parse(row.tags)).toEqual([]);
  });

  it('同 id 再保存为更新（localStorage 保留原 created_at）', async () => {
    const id = await saveTemplate({ name: 'v1', body: 'a', tags: '[]' });
    await new Promise((r) => setTimeout(r, 3));
    await saveTemplate({ id, name: 'v2', body: 'b', tags: '[]' });
    const list = await listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('v2');
    // created_at 未被更新覆盖
    expect(list[0].created_at).not.toBe(list[0].updated_at);
  });

  it('列表超上限截断到 200 条（防配额失控）', async () => {
    for (let i = 0; i < 202; i++) {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify([
          ...JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'),
          { id: `old-${i}`, name: `t${i}`, body: 'x', tags: '[]', created_at: '2026-01-01', updated_at: '2026-01-01' },
        ]),
      );
    }
    await saveTemplate({ name: '新模板', body: 'y', tags: '[]' });
    const list = await listTemplates();
    expect(list.length).toBeLessThanOrEqual(200);
    expect(list[0].name).toBe('新模板');
  });
});

describe('templateStore（SQLite 路径）', () => {
  beforeEach(() => {
    localStorage.clear();
    state.useSqlite = true;
    state.rows = [];
    state.executed = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('保存走参数化 UPSERT；列表走 SELECT 排序；删除按 rowsAffected 判定', async () => {
    const id = await saveTemplate({ name: '模板A', body: '{{x}}', tags: '["UI"]' });
    const insert = state.executed.find((e) => /INSERT INTO templates/i.test(e.sql));
    expect(insert).toBeDefined();
    // UPSERT 保留 created_at：SQL 必须含 ON CONFLICT 更新子句且不含 created_at
    expect(insert?.sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(insert?.sql.match(/SET [^)]*/)?.[0]).not.toContain('created_at');
    // 全部值经参数传递（$1..$6），不拼接
    expect(insert?.params[0]).toBe(id);
    expect(insert?.params[1]).toBe('模板A');

    // 首次调用为建表兜底 DDL
    expect(state.executed[0].sql).toContain('CREATE TABLE IF NOT EXISTS templates');

    const list = await listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('模板A');

    const ok = await deleteTemplate(id);
    expect(ok).toBe(true);
    expect(await listTemplates()).toHaveLength(0);

    const ok2 = await deleteTemplate('不存在');
    expect(ok2).toBe(false);
  });

  it('同 id 更新覆盖其余字段但保留 created_at（与 localStorage 路径对齐）', async () => {
    const id = await saveTemplate({ name: 'v1', body: 'a', tags: '[]' });
    const originalCreatedAt = state.rows[0].created_at;
    await saveTemplate({ id, name: 'v2', body: 'b', tags: '[]' });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].name).toBe('v2');
    expect(state.rows[0].created_at).toBe(originalCreatedAt);
  });
});
