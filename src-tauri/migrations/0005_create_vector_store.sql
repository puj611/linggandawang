-- Phase C: 创建向量存储表（用于 RAG 历史答案检索）
-- vector_json: 持久化嵌入向量本体（JSON 数组），恢复时直接复用，避免冷启动全量重嵌入（P1）
CREATE TABLE IF NOT EXISTS vector_store (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  vector_json TEXT,
  created_at TEXT NOT NULL
);
