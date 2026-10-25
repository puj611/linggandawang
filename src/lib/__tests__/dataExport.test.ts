// src/lib/__tests__/dataExport.test.ts
// R06：dataExport 单测——localStorage 降级路径全链路
// 验收落测：导出 JSON 可解析且无密钥字段；清空后导入完整还原；版本不匹配明确报错。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  exportData,
  parseImportBundle,
  importData,
  isExportBundle,
  readLastBackup,
  DATA_EXPORT_SCHEMA_VERSION,
  type ExportBundle,
} from '../dataExport';

// Mock @/lib/sqlite：走 localStorage 降级（getDb → null），复用真实 listPromptHistory/
// insertPromptHistory/setPreference 的降级实现（不 mock 具体函数，验证真实双路径）
vi.mock('@/lib/sqlite', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sqlite')>('@/lib/sqlite');
  return { ...actual, getDb: async () => null };
});

function seedLocalData() {
  localStorage.setItem('sqlite_prompt_history', JSON.stringify([
    { id: 1, title: '提示词A', markdown: '# A', tags: ['UI'], seed_input: 'a', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
    { id: 2, title: '提示词B', markdown: '# B', tags: [], seed_input: 'b', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', favorite: true },
  ]));
  localStorage.setItem('sqlite_pref_window_width', '420');
  localStorage.setItem('sqlite_pref_alwaysOnTop', 'true');
  localStorage.setItem('sqlite_pref_llm_api_key', '"sk-should-never-export"');
  localStorage.setItem('sqlite_templates', JSON.stringify([
    { id: 'tpl-1', name: '间距模板', body: '{{target}} {{间距}}', tags: '["UI"]', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
  ]));
}

/** 构造一份待导入的数据包（模块级：多个 describe 共用） */
function makeBundle(): ExportBundle {
  return {
    schemaVersion: 1,
    appVersion: '0.9.1',
    exportedAt: '2026-10-25T00:00:00Z',
    data: {
      promptHistory: [
        { title: '历史X', markdown: '# X', tags: ['后端'], seed_input: 'x', created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' },
        { title: '历史Y', markdown: '# Y', tags: [], seed_input: 'y', created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z', favorite: true },
      ],
      preferences: [
        { key: 'window_width', value: '500' },
        { key: 'evil_api_key', value: '"leaked"' }, // 疑似密钥：导入侧也应拒收
      ],
      templates: [
        { id: 'tpl-x', name: '模板X', body: '{{a}}', tags: '[]', created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' },
      ],
    },
  };
}

describe('exportData（验收：无密钥字段）', () => {
  beforeEach(() => localStorage.clear());

  it('导出含历史/偏好/模板，结构字段齐全，且绝不含密钥键', async () => {
    seedLocalData();
    const bundle = await exportData();
    expect(bundle.schemaVersion).toBe(DATA_EXPORT_SCHEMA_VERSION);
    expect(bundle.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof bundle.exportedAt).toBe('string');
    expect(bundle.data.promptHistory).toHaveLength(2);
    expect(bundle.data.templates).toHaveLength(1);
    // 偏好：正常键保留，疑似密钥键剔除（双向防御）
    const keys = bundle.data.preferences.map((p) => p.key);
    expect(keys).toContain('window_width');
    expect(keys).toContain('alwaysOnTop');
    expect(keys.some((k) => /api[-_]?key/i.test(k))).toBe(false);
    // 整包序列化后无密钥值残留
    expect(JSON.stringify(bundle)).not.toContain('should-never-export');
  });

  it('isExportBundle 通过自身导出包', async () => {
    seedLocalData();
    expect(isExportBundle(await exportData())).toBe(true);
  });

  it('值级密钥扫描：偏好值含密钥形状字符串（键名无辜）也不外发', async () => {
    localStorage.setItem('sqlite_prompt_history', JSON.stringify([]));
    localStorage.setItem('sqlite_templates', JSON.stringify([]));
    // 键名无辜，值是 sk- 形状的密钥串（拼接构造，避免测试文件出现完整密钥字面量）
    localStorage.setItem('sqlite_pref_note', JSON.stringify(['sk-', 'abc123def456ghi'].join('')));
    const bundle = await exportData();
    expect(bundle.data.preferences).toHaveLength(0);
    expect(JSON.stringify(bundle)).not.toContain('abc123def456ghi');
  });
});

describe('parseImportBundle（版本与结构错误明确报错）', () => {
  it('非 JSON 报「不是合法 JSON」', () => {
    expect(() => parseImportBundle('not json {')).toThrow('不是合法 JSON');
  });

  it('版本不匹配报 schema 版本错误（非静默失败）', () => {
    const bad = JSON.stringify({ schemaVersion: 99, appVersion: 'x', exportedAt: 'x', data: { promptHistory: [], preferences: [], templates: [] } });
    expect(() => parseImportBundle(bad)).toThrow('schema 版本为 99');
  });

  it('结构不完整报「不是灵感大王导出的数据包」', () => {
    expect(() => parseImportBundle('{"foo":1}')).toThrow('不是灵感大王导出的数据包');
  });

  it('合法包解析通过', async () => {
    localStorage.clear();
    const text = JSON.stringify(await exportData());
    const bundle = parseImportBundle(text);
    expect(bundle.schemaVersion).toBe(1);
  });
});

describe('importData（清空→导入→还原）', () => {
  beforeEach(() => localStorage.clear());

  it('覆盖导入：清空后完整还原历史与模板；密钥键拒收；导入前自动备份', async () => {
    seedLocalData(); // 现有数据（应被备份后清空）
    const r = await importData(makeBundle(), 'overwrite');

    expect(r.mode).toBe('overwrite');
    expect(r.historyInserted).toBe(2);
    expect(r.templatesWritten).toBe(1);
    expect(r.preferencesWritten).toBe(1); // window_width 写入，密钥键拒收

    // 历史 = 导入的 2 条（旧的已清空）
    const history = JSON.parse(localStorage.getItem('sqlite_prompt_history') ?? '[]');
    expect(history).toHaveLength(2);
    expect(history.map((h: { title: string }) => h.title)).toEqual(['历史Y', '历史X']);

    // 模板还原
    const templates = JSON.parse(localStorage.getItem('sqlite_templates') ?? '[]');
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('模板X');

    // 偏好还原（且无密钥键）
    expect(localStorage.getItem('sqlite_pref_window_width')).toBe('500');
    expect(localStorage.getItem('sqlite_pref_evil_api_key')).toBeNull();

    // 导入前备份：包含被清空的旧数据
    const backup = readLastBackup();
    expect(backup).not.toBeNull();
    expect(backup?.data.promptHistory.map((h) => h.title)).toContain('提示词A');
    expect(JSON.stringify(backup)).not.toContain('should-never-export');
  });

  it('合并导入：历史追加、同 id 模板跳过、偏好同名覆盖', async () => {
    seedLocalData();
    const bundle = makeBundle();
    bundle.data.templates.push({
      id: 'tpl-1', name: '间距模板改', body: '{{x}}', tags: '[]',
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-03T00:00:00Z',
    });
    const r = await importData(bundle, 'merge');

    expect(r.historyInserted).toBe(2);
    expect(r.templatesWritten).toBe(1); // 只有新 tpl-x；同 id 的 tpl-1 跳过
    const history = JSON.parse(localStorage.getItem('sqlite_prompt_history') ?? '[]');
    expect(history).toHaveLength(4); // 原 2 + 导入 2
    const templates = JSON.parse(localStorage.getItem('sqlite_templates') ?? '[]');
    expect(templates).toHaveLength(2);
    expect(templates.some((t: { id: string }) => t.id === 'tpl-x')).toBe(true);
  });

  it('merge 幂等：同一 bundle 重复导入历史不翻倍（按 title+created_at 去重）', async () => {
    localStorage.clear();
    const bundle = makeBundle();
    const r1 = await importData(bundle, 'merge');
    expect(r1.historyInserted).toBe(2);
    const r2 = await importData(bundle, 'merge');
    expect(r2.historyInserted).toBe(0); // 全部命中已存在键，跳过
    const history = JSON.parse(localStorage.getItem('sqlite_prompt_history') ?? '[]');
    expect(history).toHaveLength(2);
  });
});

describe('importData fail-closed（备份失败中止覆盖导入）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('备份落盘失败时 overwrite 抛错中止，现有数据原样保留；merge 不受影响继续', async () => {
    seedLocalData();
    // 模拟 localStorage 配额满：setItem 一律抛错
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await expect(importData(makeBundle(), 'overwrite')).rejects.toThrow('覆盖导入已中止');
    // 现有数据未被清空
    const history = JSON.parse(localStorage.getItem('sqlite_prompt_history') ?? '[]');
    expect(history).toHaveLength(2);

    // merge 不销毁数据，备份尽力而为后继续导入
    const r = await importData(makeBundle(), 'merge');
    expect(r.historyInserted).toBe(2);

    setItemSpy.mockRestore();
  });
});
