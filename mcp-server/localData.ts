// mcp-server/localData.ts
// MCP 进程的本地数据访问层：直连桌面端写入的 SQLite / JSON 文件，不依赖 Tauri。
// 为什么单独实现而不复用 src/lib/*Store：那些模块依赖 @/lib/sqlite（走 Tauri invoke），
// MCP 是纯 node 子进程，没有 Tauri 运行时。这里用 node:sqlite 只读打开同一份文件。
// 全部只读：MCP 不写用户数据，避免与桌面端并发写冲突。
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

// node:sqlite 惰性加载：本模块被 mcp-server/tools.ts 引用，而 tools.ts 也被
// src/mcp-server.test.ts（jsdom 环境）导入做协议层单测。静态 import 'node:sqlite'
// 会让 Vite 在浏览器构建下解析失败（resolved id: sqlite）。
// 改为仅在真正打开数据库时 createRequire 加载，纯协议测试不会触达。
const nodeRequire = createRequire(import.meta.url);

type DatabaseLike = {
  prepare: (sql: string) => { all: (...p: unknown[]) => unknown[]; get: (...p: unknown[]) => unknown };
  close: () => void;
};

function openSqlite(file: string): DatabaseLike | null {
  try {
    const mod = nodeRequire('node:sqlite') as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => DatabaseLike };
    return new mod.DatabaseSync(file, { readOnly: true });
  } catch {
    return null;
  }
}

/** 桌面端 Tauri identifier（决定 AppData 目录名） */
const APP_IDENTIFIER = 'com.linggandawang.app';

/** 允许覆盖数据目录（测试/多 profile 场景）：LINGGAN_DATA_DIR */
function dataDir(): string {
  const override = process.env.LINGGAN_DATA_DIR;
  if (override) return override;
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support')
      : path.join(homedir(), '.config'));
  return path.join(appData, APP_IDENTIFIER);
}

export function dbPath(): string {
  return path.join(dataDir(), 'linggandawang.db');
}

export function contextPath(): string {
  return path.join(dataDir(), 'context.json');
}

/** 数据源是否可用（桌面端是否至少运行过一次） */
export function dataAvailable(): boolean {
  return existsSync(dbPath()) || existsSync(contextPath());
}

/** 只读打开数据库；文件不存在或打不开时返回 null（不抛，调用方降级为空结果） */
function openDb(): DatabaseLike | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  return openSqlite(p);
}

export interface TemplateRecord {
  id: string;
  name: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    // 标签损坏时按无标签处理，不阻塞列表
  }
  return [];
}

/** 读取用户模板（按 updated_at 倒序）。数据库或表不存在时返回空数组。 */
export function readTemplates(): TemplateRecord[] {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare('SELECT id, name, body, tags, created_at, updated_at FROM templates ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      body: String(r.body),
      tags: parseTags(r.tags),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export interface HistoryRecord {
  id: number;
  title: string;
  markdown: string;
  seed_input: string;
  favorite: boolean;
  created_at: string;
}

/** 读取提示词历史（按 created_at 倒序）。 */
export function readHistory(limit: number, favoriteOnly: boolean): HistoryRecord[] {
  const db = openDb();
  if (!db) return [];
  try {
    const sql =
      'SELECT id, title, markdown, seed_input, favorite, created_at FROM prompt_history' +
      (favoriteOnly ? ' WHERE favorite = 1' : '') +
      ' ORDER BY created_at DESC LIMIT ?';
    const rows = db.prepare(sql).all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      title: String(r.title),
      markdown: String(r.markdown),
      seed_input: r.seed_input == null ? '' : String(r.seed_input),
      favorite: Number(r.favorite) === 1,
      created_at: String(r.created_at),
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export interface RecentQA {
  question_id: string;
  question_text: string;
  answer: string;
  answered_at: string;
}

export interface UserPreferences {
  preferences: Array<{ key: string; value: string; confirmed_at: string }>;
  recent_qa: RecentQA[];
  project?: { name?: string; project_type?: string };
}

/** 读取 context.json（桌面端维护的问答上下文）。文件缺失/损坏时返回空结构。 */
export function readContext(): UserPreferences {
  const p = contextPath();
  if (!existsSync(p)) return { preferences: [], recent_qa: [] };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    const prefs = Array.isArray(raw.preferences)
      ? (raw.preferences as Array<Record<string, unknown>>).map((x) => ({
          key: String(x.key ?? ''),
          value: String(x.value ?? ''),
          confirmed_at: String(x.confirmed_at ?? ''),
        }))
      : [];
    const qa = Array.isArray(raw.recent_qa)
      ? (raw.recent_qa as Array<Record<string, unknown>>).map((x) => ({
          question_id: String(x.question_id ?? ''),
          question_text: String(x.question_text ?? ''),
          answer: String(x.answer ?? ''),
          answered_at: String(x.answered_at ?? ''),
        }))
      : [];
    const proj = raw.project as Record<string, unknown> | undefined;
    return {
      preferences: prefs,
      recent_qa: qa,
      ...(proj
        ? { project: { name: proj.name as string | undefined, project_type: proj.project_type as string | undefined } }
        : {}),
    };
  } catch {
    return { preferences: [], recent_qa: [] };
  }
}
