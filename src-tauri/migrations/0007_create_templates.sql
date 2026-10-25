-- migration 0007: 用户变量模板表（R05 变量模板 MVP）
-- 保存为带 {{变量}} 占位符的提示词模板，填参复用：
--   body = 模板正文（可含 {{变量}} 占位符，使用时实时解析）
--   tags = 分类标签 JSON 数组字符串
CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_updated_at
    ON templates(updated_at DESC);
