-- migration 0006: 前后对比记录表（R04 前后对比测试 MVP）
-- 留档同一输入两版提示词的对比结果：
--   left_json  = 旧版（A 侧）PromptResult JSON
--   right_json = 新版（B 侧）PromptResult JSON
--   diff_json  = ComparisonEngine 输出的差异结构快照（留档，查看时以前两者实时重算为准）
CREATE TABLE IF NOT EXISTS comparison_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    left_json TEXT NOT NULL,
    right_json TEXT NOT NULL,
    diff_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comparison_runs_created_at
    ON comparison_runs(created_at DESC);
