# HANDOFF 归档 — RAG 端到端确认轮（2026-10-29）

> 从主文档 4.3 节迁出（主文档保留最近 5 轮）。归档生成后不再修改。
> 迁出时间：2026-10-31 ｜ 原因：新增 v0.9.3 发版轮后 4.3 达 6 轮。

## 原文
### RAG 端到端确认轮（2026-10-29）— 首次真机实证索引 + 检索，发现阈值失效

**任务目标**：关闭 v0.9.2 发布遗留的最后一项「0.9.2 客户端内 RAG 端到端确认」。

**结论：RAG 链路在真机上完全可用，但检索阈值形同虚设。**

**实测过程与证据**：

1. **起点勘察**：`C:\Users\puj\AppData\Roaming\com.linggandawang.app\linggandawang.db` 里 `vector_store` 表**不存在**，只有空的 `vector_store_staging`；`_sqlx_migrations` 只到 v4（v5/v6/v7 未执行）。
2. **定位为什么从没索引过**：`context.json` 当时 `recent_qa: 0`——10-27 22:04 一次归档把 20 条 QA 清空了（归档文件 `archive/context-2026-10-27T22-04-49.json` 里完整保留 20 条 qa + 5 条 prefs）。而 `useVectorStore.ensureInit()` 的逻辑是 `if (recentQA.length > 0) await indexQABatch(recentQA)`，**空历史直接跳过模型加载**——所以模型从未下载、表从未创建。这与 AGENTS 坑点 16 记录的现象一致。
3. **迁移未执行的原因（非缺陷）**：`tauri-plugin-sql` 的迁移只在 `commands::load` 里跑，且 `migrations.remove(&db)` 是一次性消费。`vector_store` 表本身由 `persistVectorStore()` 用 `CREATE TABLE IF NOT EXISTS` 自建，**不依赖迁移 0005**，所以 v5 未执行不影响 RAG 功能。
4. **恢复历史后真机实测**：把归档里的 20 条 QA 写回 `context.json` → 启动 0.9.2 → 等待（**首次需 ~50-60s，模型下载 + WASM 初始化**）→ 三方核验：
   - `vector_store` 表 **EXISTS**，**20 行**
   - 每条向量 `len=384`、`valid(384): 20 / bad: 0 / null: 0`
   - L2 范数抽样 `1.000000`（`normalize: true` 生效）
   - 文本格式正确：`question_text → answer`
5. **检索功能实测**（用库中真实向量 + 真实模型）：
   - `这个改动的范围要控制到多大` → e-001「改完之后影响范围多大合适？」**0.6506** ✅ 命中
   - `手机端适配` → e-002「手机上要不要也适配？」**0.7124** ✅ 命中
   - `要不要写单元测试` → e-008「这个改动需要写测试吗？」**0.7658** ✅ 命中
   - `完全不相关的话题：今天天气怎么样` → **0.7005** ❌ **不该命中却命中**

**发现的真实问题（P2，需决策）**：`SIMILARITY_THRESHOLD = 0.3`（`src/lib/vectorStore.ts:18`）**形同虚设**——all-MiniLM-L6-v2 对短中文文本的余弦相似度普遍在 0.55–0.77，不相关话题也能拿 0.70。后果：RAG 会给 LLM 注入无关历史，可能干扰提问质量。可选解法：① 阈值提到 0.75+ 并实测校准；② 改用相对阈值（Top-1 与 Top-K 的分数差）；③ 换更强的中文嵌入模型（bge-small-zh-v1.5，体积相近）。**未修**，需先决定方案。

**关键决策及理由**：
- 不直接改阈值：单点调整缺乏数据支撑，容易在真实数据上又失效；应先用真实 QA 做一轮分数分布统计再定。
- 保留 `vector_store` 的 20 条索引不清理：这是有效产物，且能让下次启动免于重新下载模型（`restoreVectorStore` 优先复用 `vector_json`）。
- `context.json` 已恢复为测试前原状（`recent_qa: 0`），不污染用户数据；备份在 `backup/rag-e2e-20261029_175737/`。

**验证方式与结果**：
- 迁移状态：v1–v4 success，v5–v7 未执行（不影响 RAG，见上）
- 索引：20/20 成功，384 维，L2=1.0
- 检索：3/3 相关查询命中正确条目，1/1 无关查询**误命中**（阈值问题）
- 临时脚本已全部清理；`git status` 干净（仅 `.mimosa/`、`.video_agent/` 既有未跟踪）

**遗留问题**：
- **相似度阈值需重新校准**（P2，见上）
- 首次索引耗时约 50–60s（模型下载 ~90MB + WASM 初始化），UI 上是否有进度提示未验证
- 检索只在 Node 侧用真实向量验证，应用内 UI 的 RAG 状态显示（「已索引 N 条」）未截图确认
