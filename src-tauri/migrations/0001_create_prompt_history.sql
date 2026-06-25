-- 提示词历史表
CREATE TABLE IF NOT EXISTS prompt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    markdown TEXT NOT NULL,
    tags_json TEXT,
    seed_input TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_history_created_at
    ON prompt_history(created_at DESC);
