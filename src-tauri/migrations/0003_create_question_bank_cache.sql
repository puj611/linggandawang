-- 问题库缓存表（用于 bank.yaml 覆盖/增量更新）
CREATE TABLE IF NOT EXISTS question_bank_cache (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    options_json TEXT,
    conditions_json TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_question_bank_category
    ON question_bank_cache(category);
