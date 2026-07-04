-- migration 0004: 为 prompt_history 增加 favorite 列，支持历史记录收藏
-- 之前版本建表时遗漏此列，导致前端 SELECT/UPDATE favorite 时报错
ALTER TABLE prompt_history ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;

-- 为收藏筛选建立索引
CREATE INDEX IF NOT EXISTS idx_prompt_history_favorite ON prompt_history(favorite);
