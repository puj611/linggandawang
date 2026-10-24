// src/lib/comparisonStore.ts
// 前后对比记录持久化（R04）：Tauri 环境写 SQLite comparison_runs 表（迁移 0006），
// 浏览器环境降级 localStorage。与 prompt_history 保持同范式：getDb() 为空走 localStorage，
// SQL 路径用 $n 占位符；所有操作单语句执行，无跨语句事务需求。
// 分层约束：本模块只存序列化 JSON 字符串，不依赖 engine/stores 层。
import { getDb } from '@/lib/sqlite';

/** localStorage 降级存储键（与 sqlite.ts 的 LS_ 前缀风格一致） */
const LS_COMPARISON_RUNS = 'sqlite_comparison_runs';
/** 降级存储最大条数（与 prompt_history 的 100 条上限一致） */
const MAX_RUNS = 100;

/** 一条前后对比记录（JSON 字段均为字符串，避免 lib 层依赖 engine 类型） */
export interface ComparisonRunRecord {
  id?: number;
  name: string;
  /** 旧版（A 侧）PromptResult JSON 字符串 */
  left_json: string;
  /** 新版（B 侧）PromptResult JSON 字符串 */
  right_json: string;
  /** ComparisonEngine 差异结构 JSON 快照（留档） */
  diff_json: string;
  created_at: string;
  updated_at: string;
}

/** 新建对比记录的输入（id 与时间戳由存储层生成） */
export type ComparisonRunInput = Omit<ComparisonRunRecord, 'id' | 'created_at' | 'updated_at'>;

/** tauri-plugin-sql Database 的最小结构（规避 any，仅声明用到的方法） */
type SqliteDb = {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  select: <T>(sql: string, params?: unknown[]) => Promise<T>;
};

/** 建表/建索引兜底：与迁移 0006 一致，防止旧库未执行迁移时写入失败或首启全表扫描（vectorStore 同范式） */
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS comparison_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  left_json TEXT NOT NULL,
  right_json TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const CREATE_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_comparison_runs_created_at ON comparison_runs(created_at DESC)';

/** 确保表与索引存在（两次独立 execute，规避单语句多命令的兼容性差异） */
async function ensureSchema(db: SqliteDb): Promise<void> {
  await db.execute(CREATE_TABLE_SQL);
  await db.execute(CREATE_INDEX_SQL);
}

function readRunsFromStorage(): ComparisonRunRecord[] {
  try {
    const raw = localStorage.getItem(LS_COMPARISON_RUNS);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ComparisonRunRecord[]) : [];
  } catch {
    return [];
  }
}

function writeRunsToStorage(list: ComparisonRunRecord[]): void {
  try {
    localStorage.setItem(LS_COMPARISON_RUNS, JSON.stringify(list));
  } catch (e) {
    // 配额满/被禁用时记录警告，便于用户排查（与 sqlite.ts prompt_history 同范式）
    console.warn('[comparisonStore] localStorage 写入失败（可能配额满或被禁用）', e);
  }
}

function mapRow(row: ComparisonRunRecord): ComparisonRunRecord {
  return { ...row, id: Number(row.id) };
}

/** 名称兜底：空白名归一为「未命名对比」，由 UI 层负责提供更有意义的默认名 */
function safeName(name: string): string {
  return name.trim() || '未命名对比';
}

/**
 * 保存一条对比记录，返回记录 id。
 * SQLite 路径返回 lastInsertId；localStorage 路径返回 Date.now() 生成的 id。
 */
export async function saveComparisonRun(input: ComparisonRunInput): Promise<number> {
  const now = new Date().toISOString();
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    const list = readRunsFromStorage();
    const id = Date.now();
    list.unshift({ ...input, name: safeName(input.name), id, created_at: now, updated_at: now });
    writeRunsToStorage(list.slice(0, MAX_RUNS));
    return id;
  }
  await ensureSchema(db);
  const result = (await db.execute(
    `INSERT INTO comparison_runs (name, left_json, right_json, diff_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [safeName(input.name), input.left_json, input.right_json, input.diff_json, now, now],
  )) as { lastInsertId?: number } | null;
  return result?.lastInsertId ?? 0;
}

/** 按创建时间倒序列出对比记录（最新在前） */
export async function listComparisonRuns(limit = 20): Promise<ComparisonRunRecord[]> {
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    return readRunsFromStorage().slice(0, limit);
  }
  await ensureSchema(db);
  const rows = await db.select<ComparisonRunRecord[]>(
    `SELECT id, name, left_json, right_json, diff_json, created_at, updated_at
     FROM comparison_runs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(mapRow);
}

/** 按 id 查询单条对比记录，不存在返回 null */
export async function getComparisonRunById(id: number): Promise<ComparisonRunRecord | null> {
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    return readRunsFromStorage().find((item) => item.id === id) ?? null;
  }
  await ensureSchema(db);
  const rows = await db.select<ComparisonRunRecord[]>(
    `SELECT id, name, left_json, right_json, diff_json, created_at, updated_at
     FROM comparison_runs
     WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}

/** 重命名对比记录（同步更新 updated_at） */
export async function renameComparisonRun(id: number, name: string): Promise<void> {
  const now = new Date().toISOString();
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    const list = readRunsFromStorage();
    const idx = list.findIndex((item) => item.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], name: safeName(name), updated_at: now };
      writeRunsToStorage(list);
    }
    return;
  }
  await ensureSchema(db);
  await db.execute(
    `UPDATE comparison_runs SET name = $1, updated_at = $2 WHERE id = $3`,
    [safeName(name), now, id],
  );
}

/** 删除对比记录 */
export async function deleteComparisonRun(id: number): Promise<void> {
  const db = (await getDb()) as SqliteDb | null;
  if (!db) {
    const list = readRunsFromStorage().filter((item) => item.id !== id);
    writeRunsToStorage(list);
    return;
  }
  await ensureSchema(db);
  await db.execute('DELETE FROM comparison_runs WHERE id = $1', [id]);
}
