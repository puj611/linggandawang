# HANDOFF 归档 — 大审查 + 立即修复轮（2026-10-25 深夜）

> 从主文档 4.3 节迁出（主文档保留最近 5 轮）。归档生成后不再修改。
> 迁出时间：2026-10-29 ｜ 原因：新增 RAG 检索修复轮后 4.3 达 6 轮。

## 原文
### 大审查 + 立即修复轮（2026-10-25 深夜）

**任务目标与用户决策**：用户要求用本机两项能力（`/big-review` 五维协议 + `staff-engineer-mode`→`production-readiness-review`）审查项目并出 markdown 报告；随后确认「立即修复已知问题，先出修复方案，回归通过」。

**审查结论**（v0.9.0..HEAD，33 文件 +3257 行）：总体风险**中**（无危急）。高危 2：① 生产依赖链 CVE（`@xenova/transformers@2.17.2` → protobufjs@6.11.6 critical CVE-2023-36665 + onnxruntime-web 等 3 high；攻击链=HF 模型投毒→WebView 内原型污染，概率低影响大；修复=迁 @huggingface/transformers v3，本迭代评估）② 覆盖导入备份 fail-open。中危 4（幂等/created_at 分歧/setTimeout 违规/分层漂移），低/参考若干。PRR 矩阵：构建✅/更新链⚠️Exception（OTA 未验）/供应链🔶/数据🔶（修复后✅）。质量评分 78/100。**完整报告存档于 `docs/audits/2026-10-25-v0.9.1-big-review.md`**（含已修/未修状态标注）。

**立即修复批**（commit `b6539ea`，全量 510/510，覆盖率门 exit 0）：
- #2 `backupCurrent` 返回落盘成败；**overwrite 备份失败中止**并提示先手动导出（merge 增量不销毁，保持尽力备份）——数据丢失红线 fail-closed
- #3 merge 历史按 `(title,created_at)` 去重（重复导入不翻倍）；DataPanel `importing` 态禁用防重入
- #4 templateStore SQLite 路径 `INSERT…ON CONFLICT(id) DO UPDATE` 更新保留 `created_at`（消除双路径分歧）
- #5 TemplateSaveDialog 延迟关闭定时器 ref 跟踪 + 卸载 cleanup（AGENTS setTimeout 铁律）
- #7 密钥过滤升级键名+值形状（sk-/ghp_/AKIA）双向扫描

**验证**：新增回归用例 4 条（备份失败中止且数据原样 / 两导不翻倍 / 值级密钥剔除 / created_at 保留）；tsc/lint/build/510 测试/覆盖率门全绿；CI 结果见 4.2。

**遗留**（未修，见审查报告 #4 批次）：依赖迁移评估（本迭代）、分层决策①修订 AGENTS 描述 vs ②hooks 封装（待用户拍板）、模板删除确认/列表缓存（backlog）；AGENTS 坑点 17-19 已确认写入（同日沉淀轮）。

