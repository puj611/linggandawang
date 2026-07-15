-- Phase C: 创建向量存储表（用于 RAG 历史答案检索）
CREATE TABLE IF NOT EXISTS vector_store (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
