// src/lib/dataExport.ts
// R06 数据导出与导入：把本地数据（提示词历史、偏好、变量模板）打包为单个 JSON，
// 可导入还原（合并/覆盖两种策略，导入前自动备份）。
// 安全红线：导出绝不含 API Key——密钥只存 keyring，本模块遍历的数据源中本就没有
// 密钥字段；另加防御性过滤：任何疑似密钥的偏好键在导出时被剔除。
// 分层约束：lib 层，只依赖 sqlite 同层模块，不依赖 engine/stores。
import { getDb, listPromptHistory, insertPromptHistory, setPreference } from '@/lib/sqlite';
import { listTemplates, saveTemplate, type TemplateRow } from '@/lib/templateStore';
import type { PromptHistoryRecord } from '@/lib/sqlite';
import pkg from '../../package.json';

export const DATA_EXPORT_SCHEMA_VERSION = 1;

/** 偏好键中疑似密钥的形状（防御性过滤；密钥本就不在这些数据源里） */
const SECRET_KEY_PATTERN = /(api[-_]?key|secret|token|password|credential)/i;

/** 导出文件结构 */
export interface ExportBundle {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  data: {
    promptHistory: PromptHistoryRecord[];
    /** 偏好键值对（value 保持存储层的 JSON 字符串形态） */
    preferences: Array<{ key: string; value: string }>;
    templates: TemplateRow[];
  };
}

/** 导入结果统计 */
export interface ImportResult {
  mode: 'merge' | 'overwrite';
  historyInserted: number;
  preferencesWritten: number;
  templatesWritten: number;
}

type SqliteDb = {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  select: <T>(sql: string, params?: unknown[]) => Promise<T>;
};

const LS_PREF_PREFIX = 'sqlite_pref_';
const LS_PROMPT_HISTORY = 'sqlite_prompt_history';
const LS_BACKUP_KEY = 'data_export_backup';

/** 疑似密钥的偏好键：导出与导入双向剔除 */
function looksSecret(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** 导出当前全部本地数据（绝不含密钥） */
export async function exportData(): Promise<ExportBundle> {
  const db = (await getDb()) as SqliteDb | null;

  // 历史与模板走既有接口（含双路径）
  const promptHistory = await listPromptHistory(Number.MAX_SAFE_INTEGER);
  const templates = await listTemplates();

  // 偏好：SQLite 全表 / localStorage 前缀扫描
  let preferences: Array<{ key: string; value: string }> = [];
  if (db) {
    const rows = await db.select<Array<{ key: string; value: string }>>(
      'SELECT key, value FROM user_preferences',
    );
    preferences = Array.isArray(rows) ? rows : [];
  } else {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREF_PREFIX)) {
        preferences.push({ key: k.slice(LS_PREF_PREFIX.length), value: localStorage.getItem(k) ?? '' });
      }
    }
  }
  // 防御性剔除疑似密钥键（密钥本就不在，此处兜底）
  preferences = preferences.filter((p) => !looksSecret(p.key));

  return {
    schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
    appVersion: pkg.version,
    exportedAt: new Date().toISOString(),
    data: { promptHistory, preferences, templates },
  };
}

/** 类型守卫：校验未知对象是否为合法导出包（LLM/外部文件归一化范式：unknown + 守卫） */
export function isExportBundle(v: unknown): v is ExportBundle {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.schemaVersion !== 'number') return false;
  if (o.schemaVersion !== DATA_EXPORT_SCHEMA_VERSION) return false;
  if (typeof o.appVersion !== 'string' || typeof o.exportedAt !== 'string') return false;
  const d = o.data;
  if (typeof d !== 'object' || d === null) return false;
  const dd = d as Record<string, unknown>;
  if (!Array.isArray(dd.promptHistory) || !Array.isArray(dd.preferences) || !Array.isArray(dd.templates)) {
    return false;
  }
  return dd.preferences.every(
    (p) => typeof p === 'object' && p !== null && typeof (p as { key?: unknown }).key === 'string',
  );
}

/** 解析导入文本：非 JSON / 非导出包 / 版本不匹配 各给明确错误 */
export function parseImportBundle(text: string): ExportBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('导入失败：文件不是合法 JSON');
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const sv = (parsed as { schemaVersion?: unknown }).schemaVersion;
    if (typeof sv === 'number' && sv !== DATA_EXPORT_SCHEMA_VERSION) {
      throw new Error(
        `导入失败：文件 schema 版本为 ${sv}，当前应用支持 ${DATA_EXPORT_SCHEMA_VERSION}，请升级应用后重试`,
      );
    }
  }
  if (!isExportBundle(parsed)) {
    throw new Error('导入失败：文件不是灵感大王导出的数据包（结构校验未通过）');
  }
  return parsed;
}

/** 导入前自动备份当前数据（保留最近一份），返回备份包 */
async function backupCurrent(): Promise<ExportBundle> {
  const bundle = await exportData();
  try {
    localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(bundle));
  } catch (e) {
    console.warn('[dataExport] 备份写入 localStorage 失败（可能配额满）', e);
  }
  return bundle;
}

/** 读取最近一次导入前备份（无则 null） */
export function readLastBackup(): ExportBundle | null {
  try {
    const raw = localStorage.getItem(LS_BACKUP_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isExportBundle(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 清空历史/模板/偏好（覆盖导入前调用） */
async function clearAll(db: SqliteDb | null): Promise<void> {
  if (db) {
    await db.execute('DELETE FROM prompt_history');
    await db.execute('DELETE FROM templates');
    await db.execute('DELETE FROM user_preferences');
    return;
  }
  localStorage.removeItem(LS_PROMPT_HISTORY);
  localStorage.removeItem('sqlite_templates');
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS_PREF_PREFIX)) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

/**
 * 导入数据包。
 * merge：历史追加、模板按 id 不存在才写、偏好同名覆盖（恢复设置语义）
 * overwrite：先清空当前数据再全量写入（导入前自动备份到 localStorage）
 */
export async function importData(
  bundle: ExportBundle,
  mode: 'merge' | 'overwrite',
): Promise<ImportResult> {
  if (!isExportBundle(bundle)) {
    throw new Error('导入失败：数据包结构校验未通过');
  }
  await backupCurrent();
  const db = (await getDb()) as SqliteDb | null;
  if (mode === 'overwrite') {
    await clearAll(db);
  }

  let historyInserted = 0;
  for (const rec of bundle.data.promptHistory) {
    if (typeof rec?.title !== 'string' || typeof rec?.markdown !== 'string') continue;
    await insertPromptHistory({
      title: rec.title,
      markdown: rec.markdown,
      tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === 'string') : [],
      seed_input: typeof rec.seed_input === 'string' ? rec.seed_input : '',
      created_at: typeof rec.created_at === 'string' ? rec.created_at : new Date().toISOString(),
      updated_at: typeof rec.updated_at === 'string' ? rec.updated_at : new Date().toISOString(),
      favorite: rec.favorite === true,
    });
    historyInserted += 1;
  }

  let preferencesWritten = 0;
  for (const p of bundle.data.preferences) {
    if (looksSecret(p.key)) continue; // 疑似密钥键拒收
    try {
      const parsed: unknown = JSON.parse(p.value);
      await setPreference(p.key, parsed);
      preferencesWritten += 1;
    } catch {
      // value 非法 JSON：按原字符串写入
      await setPreference(p.key, p.value);
      preferencesWritten += 1;
    }
  }

  let templatesWritten = 0;
  if (mode === 'merge') {
    const existing = new Set((await listTemplates()).map((t) => t.id));
    for (const t of bundle.data.templates) {
      if (existing.has(t.id)) continue;
      await saveTemplate({ name: t.name, body: t.body, tags: t.tags, id: t.id });
      templatesWritten += 1;
    }
  } else {
    for (const t of bundle.data.templates) {
      await saveTemplate({ name: t.name, body: t.body, tags: t.tags, id: t.id });
      templatesWritten += 1;
    }
  }

  return { mode, historyInserted, preferencesWritten, templatesWritten };
}

/** 触发浏览器下载导出 JSON（与 exportMd 同范式：blob + anchor） */
export function downloadBundle(bundle: ExportBundle, filename?: string): void {
  const name = filename ?? `linggandawang-data-${bundle.exportedAt.slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
