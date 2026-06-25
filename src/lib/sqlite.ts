// src/lib/sqlite.ts
// Tauri SQLite 封装层：Tauri 环境用 tauri-plugin-sql，浏览器环境降级为 localStorage
import { isTauri } from '@/lib/env';

const DB_NAME = 'sqlite:linggandawang.db';

// 用 any 绕过 tauri-plugin-sql 的类型导出差异（旧版默认导出 Database，
// 新版用 default export + named 类型）。运行时不影响。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseType = any;

let dbInstance: DatabaseType | null = null;
let dbPromise: Promise<DatabaseType | null> | null = null;

export async function getDb(): Promise<DatabaseType | null> {
  if (!isTauri()) return null;
  if (dbInstance) return dbInstance;
  if (dbPromise) return dbPromise;
  dbPromise = import('@tauri-apps/plugin-sql')
    .then((mod) => {
      // 兼容 default 与 named export
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Database = (mod as any).Database || (mod as any).default;
      return Database.load(DB_NAME);
    })
    .catch(() => null)
    .then((db) => {
      dbInstance = db;
      return db;
    });
  return dbPromise;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}

// =============== 提示词历史 ===============

export interface PromptHistoryRecord {
  id?: number;
  title: string;
  markdown: string;
  tags: string[];
  seed_input: string;
  created_at: string;
  updated_at: string;
  // 收藏标记：SQL 中为 INTEGER（0/1），接口层统一为 boolean
  favorite?: boolean;
}

const LS_PROMPT_HISTORY = 'sqlite_prompt_history';

function readPromptHistoryFromStorage(): PromptHistoryRecord[] {
  try {
    const raw = localStorage.getItem(LS_PROMPT_HISTORY);
    if (!raw) return [];
    return JSON.parse(raw) as PromptHistoryRecord[];
  } catch {
    return [];
  }
}

function writePromptHistoryToStorage(list: PromptHistoryRecord[]): void {
  try {
    localStorage.setItem(LS_PROMPT_HISTORY, JSON.stringify(list));
  } catch {}
}

export async function insertPromptHistory(record: Omit<PromptHistoryRecord, 'id'>): Promise<number> {
  const db = await getDb();
  if (!db) {
    const list = readPromptHistoryFromStorage();
    const id = Date.now();
    list.unshift({ ...record, id });
    writePromptHistoryToStorage(list.slice(0, 100));
    return id;
  }
  const result = await db.execute(
    `INSERT INTO prompt_history (title, markdown, tags_json, seed_input, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      record.title,
      record.markdown,
      JSON.stringify(record.tags ?? []),
      record.seed_input,
      record.created_at,
      record.updated_at,
    ],
  );
  return result.lastInsertId ?? 0;
}

export async function listPromptHistory(
  limit = 20,
  onlyFavorite = false,
): Promise<PromptHistoryRecord[]> {
  const db = await getDb();
  if (!db) {
    // localStorage 降级：在内存中按 favorite 过滤
    let list = readPromptHistoryFromStorage();
    if (onlyFavorite) list = list.filter((item) => item.favorite === true);
    return list.slice(0, limit);
  }
  // SQL 层按 favorite 字段过滤（1 = 已收藏）
  const where = onlyFavorite ? 'WHERE favorite = 1' : '';
  const rows = await (db as { select: <T>(sql: string, params?: unknown[]) => Promise<T> }).select<PromptHistoryRecord[]>(
    `SELECT id, title, markdown, tags_json as tags, seed_input, favorite, created_at, updated_at
     FROM prompt_history
     ${where}
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r: PromptHistoryRecord) => ({
    ...r,
    tags: safeParseJson<string[]>(r.tags as unknown as string, []),
    favorite: Number(r.favorite) === 1,
  }));
}

export async function getPromptHistoryById(id: number): Promise<PromptHistoryRecord | null> {
  const db = await getDb();
  if (!db) {
    const list = readPromptHistoryFromStorage();
    return list.find((item) => item.id === id) ?? null;
  }
  const rows = await (db as { select: <T>(sql: string, params?: unknown[]) => Promise<T> }).select<PromptHistoryRecord[]>(
    `SELECT id, title, markdown, tags_json as tags, seed_input, favorite, created_at, updated_at
     FROM prompt_history
     WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  return {
    ...rows[0],
    tags: safeParseJson<string[]>(rows[0].tags as unknown as string, []),
    favorite: Number(rows[0].favorite) === 1,
  };
}

export async function deletePromptHistory(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    const list = readPromptHistoryFromStorage().filter((item) => item.id !== id);
    writePromptHistoryToStorage(list);
    return;
  }
  await db.execute('DELETE FROM prompt_history WHERE id = $1', [id]);
}

/**
 * 按关键词搜索提示词历史（匹配 title 或 markdown，不区分大小写）
 * @param keyword 搜索关键词，空字符串时等价于 listPromptHistory
 * @param limit 返回上限
 */
export async function searchPromptHistory(keyword: string, limit = 20): Promise<PromptHistoryRecord[]> {
  const kw = keyword.trim();
  const db = await getDb();
  if (!db) {
    // localStorage 降级：在内存中做大小写不敏感的子串匹配
    const list = readPromptHistoryFromStorage();
    if (!kw) return list.slice(0, limit);
    const lower = kw.toLowerCase();
    return list
      .filter(
        (item) =>
          item.title.toLowerCase().includes(lower) ||
          item.markdown.toLowerCase().includes(lower),
      )
      .slice(0, limit);
  }
  // SQL 用 LIKE 做大小写不敏感匹配（SQLite 默认 ASCII 大小写不敏感）
  const pattern = `%${kw}%`;
  const rows = await (db as { select: <T>(sql: string, params?: unknown[]) => Promise<T> }).select<PromptHistoryRecord[]>(
    `SELECT id, title, markdown, tags_json as tags, seed_input, favorite, created_at, updated_at
     FROM prompt_history
     WHERE title LIKE $1 OR markdown LIKE $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [pattern, limit],
  );
  return rows.map((r: PromptHistoryRecord) => ({
    ...r,
    tags: safeParseJson<string[]>(r.tags as unknown as string, []),
    favorite: Number(r.favorite) === 1,
  }));
}

/**
 * 只查收藏的提示词（listPromptHistory 的快捷方式）
 */
export async function listFavoritePrompts(limit = 20): Promise<PromptHistoryRecord[]> {
  return listPromptHistory(limit, true);
}

/**
 * 切换某条提示词的收藏状态
 * @param id 记录主键
 * @param favorite true=收藏，false=取消收藏
 */
export async function togglePromptFavorite(id: number, favorite: boolean): Promise<void> {
  const db = await getDb();
  if (!db) {
    // localStorage 降级：原地更新 favorite 字段
    const list = readPromptHistoryFromStorage();
    const idx = list.findIndex((item) => item.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], favorite };
      writePromptHistoryToStorage(list);
    }
    return;
  }
  await db.execute(
    `UPDATE prompt_history SET favorite = $1, updated_at = $2 WHERE id = $3`,
    [favorite ? 1 : 0, new Date().toISOString(), id],
  );
}

// =============== 用户偏好 ===============

const LS_PREF_PREFIX = 'sqlite_pref_';

export async function setPreference(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  if (!db) {
    try {
      localStorage.setItem(LS_PREF_PREFIX + key, JSON.stringify(value));
    } catch {}
    return;
  }
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO user_preferences (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), now],
  );
}

export async function getPreference<T>(key: string, defaultValue: T): Promise<T> {
  const db = await getDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(LS_PREF_PREFIX + key);
      if (raw === null) return defaultValue;
      return safeParseJson<T>(raw, defaultValue);
    } catch {
      return defaultValue;
    }
  }
  const rows = await (db as { select: <T>(sql: string, params?: unknown[]) => Promise<T> }).select<{ value: string }[]>(
    'SELECT value FROM user_preferences WHERE key = $1',
    [key],
  );
  if (rows.length === 0) return defaultValue;
  return safeParseJson<T>(rows[0].value, defaultValue);
}

// =============== 问题库缓存 ===============

export interface QuestionBankCacheRecord {
  id: string;
  category: string;
  text: string;
  options?: unknown;
  conditions?: unknown;
  priority: number;
  version: number;
  updated_at: string;
}

const LS_QB_CACHE = 'sqlite_qb_cache';

function readQbCacheFromStorage(): QuestionBankCacheRecord[] {
  try {
    const raw = localStorage.getItem(LS_QB_CACHE);
    if (!raw) return [];
    return JSON.parse(raw) as QuestionBankCacheRecord[];
  } catch {
    return [];
  }
}

function writeQbCacheToStorage(list: QuestionBankCacheRecord[]): void {
  try {
    localStorage.setItem(LS_QB_CACHE, JSON.stringify(list));
  } catch {}
}

export async function upsertQuestionBankCache(record: QuestionBankCacheRecord): Promise<void> {
  const db = await getDb();
  if (!db) {
    const list = readQbCacheFromStorage();
    const idx = list.findIndex((item) => item.id === record.id);
    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    writeQbCacheToStorage(list);
    return;
  }
  await db.execute(
    `INSERT INTO question_bank_cache (id, category, text, options_json, conditions_json, priority, version, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(id) DO UPDATE SET
       category = excluded.category,
       text = excluded.text,
       options_json = excluded.options_json,
       conditions_json = excluded.conditions_json,
       priority = excluded.priority,
       version = excluded.version,
       updated_at = excluded.updated_at`,
    [
      record.id,
      record.category,
      record.text,
      JSON.stringify(record.options ?? null),
      JSON.stringify(record.conditions ?? null),
      record.priority,
      record.version,
      record.updated_at,
    ],
  );
}

export async function listQuestionBankCache(category?: string): Promise<QuestionBankCacheRecord[]> {
  const db = await getDb();
  if (!db) {
    let list = readQbCacheFromStorage();
    if (category) list = list.filter((item) => item.category === category);
    return list.sort((a, b) => b.priority - a.priority);
  }
  const sql = category
    ? `SELECT id, category, text, options_json as options, conditions_json as conditions, priority, version, updated_at
       FROM question_bank_cache
       WHERE category = $1
       ORDER BY priority DESC, id`
    : `SELECT id, category, text, options_json as options, conditions_json as conditions, priority, version, updated_at
       FROM question_bank_cache
       ORDER BY category, priority DESC, id`;
  const params = category ? [category] : [];
  const rows = await (db as { select: <T>(sql: string, params?: unknown[]) => Promise<T> }).select<QuestionBankCacheRecord[]>(sql, params);
  return rows.map((r: QuestionBankCacheRecord) => ({
    ...r,
    options: safeParseJson<unknown>(r.options as unknown as string, null),
    conditions: safeParseJson<unknown>(r.conditions as unknown as string, null),
  }));
}

// =============== 工具函数 ===============

function safeParseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw || raw === 'null') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
