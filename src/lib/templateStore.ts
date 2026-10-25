// src/lib/templateStore.ts
// 用户变量模板持久化（R05）：Tauri 环境写 SQLite templates 表（迁移 0007），
// 浏览器环境降级 localStorage。与 comparisonStore 保持同范式：getDb() 为空走
// localStorage，SQL 路径用 $1 占位符；单语句执行，无跨语句事务需求。
// 分层约束：本模块只存字符串字段（tags 为 JSON 数组字符串），不依赖 engine/stores 层。
import { getDb } from '@/lib/sqlite';

const LS_TEMPLATES = 'sqlite_templates';
/** 降级存储上限（模板体积大于历史记录，给 200 条） */
const MAX_TEMPLATES = 200;

/** 模板存储行（engine 的 UserTemplate 在组件层映射，lib 层不依赖 engine 类型） */
export interface TemplateRow {
  id: string;
  name: string;
  body: string;
  /** 分类标签 JSON 数组字符串 */
  tags: string;
  created_at: string;
  updated_at: string;
}

/** 新建模板输入（id 与时间戳由存储层生成） */
export type TemplateInput = Pick<TemplateRow, 'name' | 'body' | 'tags'>;

type SqliteDb = {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  select: <T>(sql: string, params?: unknown[]) => Promise<T>;
};

// 建表/建索引：静态 DDL 字面量（无任何用户输入参与，与迁移 0007 一致的兜底）
async function ensureSchema(db: SqliteDb): Promise<void> {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_templates_updated_at ON templates(updated_at DESC)',
  );
}

function readFromStorage(): TemplateRow[] {
  try {
    const raw = localStorage.getItem(LS_TEMPLATES);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TemplateRow[]) : [];
  } catch {
    return [];
  }
}

function writeToStorage(list: TemplateRow[]): void {
  try {
    localStorage.setItem(LS_TEMPLATES, JSON.stringify(list));
  } catch (e) {
    console.warn('[templateStore] localStorage 写入失败（可能配额满或被禁用）', e);
  }
}

/** 生成模板 id：crypto.randomUUID 优先，降级时间戳+随机数 */
function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // 降级路径
  }
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeRow(row: TemplateRow): TemplateRow {
  const tags = (() => {
    try {
      const parsed: unknown = JSON.parse(row.tags);
      return Array.isArray(parsed) ? JSON.stringify(parsed) : '[]';
    } catch {
      return '[]';
    }
  })();
  return {
    ...row,
    name: row.name.trim() || '未命名模板',
    tags,
  };
}

/** 保存（新增或按 id 整体更新），返回模板 id */
export async function saveTemplate(input: TemplateInput & { id?: string }): Promise<string> {
  const now = new Date().toISOString();
  const id = input.id ?? genId();
  const row = safeRow({ ...input, id, created_at: now, updated_at: now });
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    const list = readFromStorage().filter((t) => t.id !== id);
    // 更新语义：保留原 created_at
    const old = readFromStorage().find((t) => t.id === id);
    const merged = old ? { ...row, created_at: old.created_at } : row;
    list.unshift(merged);
    writeToStorage(list.slice(0, MAX_TEMPLATES));
    return id;
  }
  await ensureSchema(db);
  // SQLite 路径：INSERT OR REPLACE（同 id 覆盖；created_at 以传入为准，更新时组件层先读原行）
  await db.execute(
    'INSERT OR REPLACE INTO templates (id, name, body, tags, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [row.id, row.name, row.body, row.tags, row.created_at, row.updated_at],
  );
  return id;
}

/** 全量列表，按 updated_at 倒序 */
export async function listTemplates(): Promise<TemplateRow[]> {
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    return [...readFromStorage()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }
  await ensureSchema(db);
  const rows = await db.select<TemplateRow[]>(
    'SELECT id, name, body, tags, created_at, updated_at FROM templates ORDER BY updated_at DESC',
  );
  return Array.isArray(rows) ? rows : [];
}

/** 按 id 删除，返回是否删除成功 */
export async function deleteTemplate(id: string): Promise<boolean> {
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    const before = readFromStorage().length;
    writeToStorage(readFromStorage().filter((t) => t.id !== id));
    return readFromStorage().length < before;
  }
  await ensureSchema(db);
  const result = (await db.execute('DELETE FROM templates WHERE id = $1', [id])) as {
    rowsAffected?: number;
  };
  return (result?.rowsAffected ?? 0) > 0;
}
