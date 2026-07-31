# 灵感大王 · 后续开发 PRD

> **文档定位**：基于 2026-07-25 项目现状（项目扫描器 + 上下文注入已完成）的后续开发产品需求文档。
> **版本**：v1.1（修正版：同步 F1/F2 已完成的真实状态）
> **日期**：2026-07-25
> **阶段**：复赛冲刺期（距 08/10 提交约 16 天）
> **依赖文档**：`docs/灵感-下一步方向.md`、`docs/架构设计.md`、`docs/后续开发项目计划.md`
> **修订记录**：v1.1 修正 F1/F2 现状描述（原标记为未完成，实际已完成），重排开发顺序

---

## 一、项目现状

### 1.1 已完成功能（截至 2026-07-25）

| 模块 | 状态 | 说明 |
|---|---|---|
| 悬浮窗四态 | ✅ | ball / expanded / question / result |
| 提问引擎（5阶段31题） | ✅ | perceive / name / spec / execute / verify |
| 提示词四段生成 | ✅ | action / spec / constraint / verify |
| LLM 接入层 | ✅ | OpenAI 兼容协议 + 视觉模型支持 |
| **三模式系统** | ✅ | PPT / Frontend / Backend 显式选择 + auto 兜底 |
| **灵感广场** | ✅ | 30 个种子（每类10个）+ 场景过滤 + 随机换一个 |
| 截图诊断 | ✅ | Canvas 实现（Rust 版未迁移） |
| 图片提示词拆解 | ✅ | 视觉模型提取 + 参考图面板 |
| RAG 向量检索 | ✅ | 本地嵌入 + 相似历史 QA 注入 |
| 上下文管理 | ✅ | contextStore + 过期归档 + 偏好学习 |
| **项目指纹（F1）** | ✅ | Rust 端 `scan_project` + 前端 `analyzeFingerprint` 已联调 |
| **项目深度扫描（F1）** | ✅ | `scanner.rs` 实现：文件树 + Git 状态 + 依赖图 + TODO 扫描 + full_scan |
| **前端扫描仪表盘（F1）** | ✅ | `ProjectScanDashboard.tsx` 五标签页（概览/文件/Git/依赖/TODO）|
| **上下文注入（F2）** | ✅ | `PromptGenerator.buildProjectContext` 已实现，注入项目指纹到提示词 |

### 1.2 核心断层（已从 3 个收敛为 2 个）

**F1（项目扫描器）+ F2（上下文注入）已打通，剩余断层：**

1. **进度去重未联动**：提示词已注入项目上下文，但 Selector 选题时未基于已完成 TODO 过滤，仍可能重复提问已完成任务
2. **智能降级体验粗糙**：无 LLM / 本地 SLM / 云端 LLM 三档体验不清晰，错误/空状态不完善

### 1.3 F1/F2 完成度验证证据

- **Rust 端**：`src-tauri/src/scanner.rs` 完整实现 `scan_file_tree` / `parse_git_status` / `analyze_dependencies` / `scan_todos` / `full_scan`
- **命令注册**：`src-tauri/src/lib.rs` 已注册 `scan_project` / `full_scan_project` / `scan_file_tree_cmd` / `git_status_cmd` / `analyze_deps_cmd`
- **前端联调**：`src/lib/projectScanner.ts` 封装 Tauri invoke + Web mock 回退
- **仪表盘**：`src/components/ProjectScanDashboard.tsx` 五标签页可视化
- **上下文注入**：`src/engine/PromptGenerator.ts` 的 `buildProjectContext` 方法已实现
- **待补**：F1/F2 缺少单测覆盖、三模式联动差异化逻辑待完善、端到端验收测试未做

---

## 二、需求分析

### 2.1 用户核心痛点

| 痛点 | 场景 | 当前状态 |
|---|---|---|
| ~~提示词与项目脱节~~ | 用户在项目 A 中生成的提示词，不含项目 A 的 技术栈/约束 | ✅ 已解决（F2 上下文注入） |
| 重复提问 | 已完成的任务再次被提问，浪费时间 | ❌ 未实现（F3 待做） |
| 离线体验断崖 | 无 LLM 时功能不可用或体验差 | 🔶 部分降级（F4 待做） |
| F1/F2 缺少测试保障 | 扫描器/注入逻辑无单测，回归风险高 | ❌ 未实现（F5 待做） |

### 2.2 业务目标

**复赛提交最低标准（Must Have）：**
- ~~项目扫描器可用：输入路径 → 输出文件结构 + 技术栈 + Git 状态~~ ✅ 已完成
- ~~提示词自动注入项目上下文~~ ✅ 已完成
- F1/F2 验收测试补齐：单测覆盖核心扫描/注入逻辑
- 核心闭环稳定无报错（端到端验收）
- 测试覆盖率 ≥ 75%

**加分标准（Nice to Have）：**
- 进度去重：已完成任务不再重复提问（F3）
- 三档降级体验清晰（F4.1）
- 问题库 60+ 条（F5.3）
- F2.2 三模式联动差异化（PPT 弱化 / Frontend 强化框架 / Backend 强化语言）

### 2.3 非目标（明确不做）

| 功能 | 推迟理由 |
|---|---|
| 多轮迭代闭环（M14） | 依赖阶段二完整，工时不足 |
| 技术债感知（M15） | 锦上添花，非核心差异化 |
| 架构决策辅助（M16） | 低影响力 + 高实现难度 |
| 深色/浅色主题切换 | 基础体验，不影响核心价值 |
| 团队协作 / 插件生态 | 长期规划，非复赛重点 |

---

## 三、功能模块

### 3.1 模块总览

```
后续开发（F1/F2 已完成，重点在 F3/F4/F5）
├── F1：项目扫描器闭环 ✅ 已完成（需补单测）
│   ├── F1.1 Rust 端 scan_project 完整实现 ✅
│   ├── F1.2 文件结构扫描 + 技术栈识别 ✅
│   ├── F1.3 Git 状态解析 ✅
│   ├── F1.4 前端仪表盘联调 ✅
│   └── F1.6 单测补齐（scanner.rs + projectScanner.ts）⏳
│
├── F2：上下文注入 ✅ 已完成（需补差异化 + 单测）
│   ├── F2.1 PromptGenerator 注入项目上下文段 ✅
│   ├── F2.2 三模式场景 × 项目上下文联动 ⏳（差异化待完善）
│   └── F2.3 上下文注入单测 ⏳
│
├── F3：进度去重（重要，P1）❌ 待开发
│   ├── F3.1 RequirementSyncer 联动项目扫描
│   └── F3.2 Selector 基于已完成任务过滤
│
├── F4：体验打磨（重要，P1）❌ 待开发
│   ├── F4.1 三档降级体验 UI
│   ├── F4.2 错误状态 / 空状态完善
│   └── F4.3 视觉动效优化
│
└── F5：质量加固（支撑，P0）🔶 部分待做
    ├── F5.1 核心模块单测补齐（F1/F2 + seedRouter + RequirementSyncer）
    ├── F5.2 集成测试覆盖主流程
    └── F5.3 问题库扩充（31→60+）
```

### 3.2 功能详细说明

#### F1：项目扫描器闭环（P0）✅ 已完成

**目标**：用户输入项目路径，自动扫描并输出结构化项目指纹。

**子功能：**

| ID | 功能 | 输入 | 输出 | 状态 |
|---|---|---|---|---|
| F1.1 | scan_project 命令 | `path: string` | `ProjectFingerprint` | ✅ 已实现 |
| F1.2 | 文件结构扫描 | 项目路径 | 目录树（忽略 node_modules / .git / dist）+ 扩展名统计 | ✅ 已实现 |
| F1.3 | 技术栈识别 | package.json / Cargo.toml / go.mod 等 | `{ framework, language, build_tool, dependencies }` | ✅ 已实现 |
| F1.4 | Git 状态解析 | 项目路径 | `{ branch, status, recent_commits }` | ✅ 已实现 |
| F1.5 | 前端仪表盘联调 | 扫描结果 | ProjectScanDashboard 可视化展示 | ✅ 已实现 |
| F1.6 | 深度扫描（full_scan） | 项目路径 | 文件树 + Git + 依赖图 + TODO | ✅ 已实现 |
| F1.7 | 单测补齐 | - | scanner.rs + projectScanner.ts 单测 | ⏳ 待做 |

**验收标准（待回归确认）：**
- ~~1000 文件项目扫描 < 10 秒~~ 待实测
- ~~准确识别 React / Vue / Tauri / Node / Python 等主流技术栈~~ 待实测
- ~~敏感文件（.env / *.pem / *.key）自动跳过~~ 待实测
- ~~扫描进度实时反馈~~ 待实测

#### F2：上下文注入（P0）✅ 主体已完成

**目标**：提示词生成时自动携带项目上下文，提升提示词针对性。

**子功能：**

| ID | 功能 | 说明 | 状态 |
|---|---|---|---|
| F2.1 | 项目上下文段 | PromptGenerator 新增 `project_context` 段，含技术栈/目录/Git | ✅ 已实现（buildProjectContext） |
| F2.2 | 三模式联动 | PPT 模式弱化项目上下文；Frontend/Backend 模式强化 | ⏳ 差异化逻辑待完善 |
| F2.3 | 上下文折叠展示 | 结果态可折叠展示项目上下文段 | 🔶 现状未明确，需检查 |
| F2.4 | 单测补齐 | buildProjectContext 单测 | ⏳ 待做 |

**验收标准（待回归确认）：**
- ~~生成的提示词 100% 包含项目上下文段（有项目时）~~ 待端到端验证
- ~~项目上下文段内容准确，无敏感信息泄露~~ 待安全审计
- ~~PPT 模式下项目上下文段为空或极简~~ 待 F2.2 完善后验证

#### F3：进度去重（P1）

**目标**：基于项目扫描结果，过滤已完成的任务，避免重复提问。

**子功能：**

| ID | 功能 | 说明 | 优先级 |
|---|---|---|---|
| F3.1 | 需求同步联动 | RequirementSyncer 读取项目扫描结果，识别已完成 TODO | P1 |
| F3.2 | Selector 过滤 | 选题时排除已完成任务相关的问题 | P1 |

**验收标准：**
- 已完成的 TODO 对应的问题不再被选中
- 去重逻辑可开关（用户可关闭）

#### F4：体验打磨（P1）

**目标**：三档降级体验清晰，错误/空状态完善。

**子功能：**

| ID | 功能 | 说明 | 优先级 |
|---|---|---|---|
| F4.1 | 三档降级 UI | 无 LLM（基础模式）/ 本地 SLM / 云端 LLM 三档视觉区分 | P1 |
| F4.2 | 错误/空状态 | 扫描失败、LLM 超时、无项目等场景的友好提示 | P1 |
| F4.3 | 视觉动效 | 状态切换、标签飞入、扫描进度等动效优化 | P2 |

#### F5：质量加固（P0）

**目标**：测试覆盖率 ≥ 75%，核心链路稳定。

**子功能：**

| ID | 功能 | 范围 | 优先级 |
|---|---|---|---|
| F5.1 | 单测补齐 | seedRouter / RequirementSyncer / PromptGenerator（项目上下文段）| P0 |
| F5.2 | 集成测试 | 输入→提问→生成→复制 全流程 | P0 |
| F5.3 | 问题库扩充 | 31 → 60+ 条，覆盖三模式 | P1 |

---

## 四、技术方案

### 4.1 架构原则（继承现有）

- **分层架构**：UI → Hooks → Engine → Lib → Rust，禁止反向依赖
- **纯函数引擎**：engine 层无状态纯函数，可独立测试
- **最小权限**：Tauri capabilities 仅授必要权限
- **类型安全**：TypeScript strict，禁止 `any`
- **异步安全**：async 操作需 mountedRef 保护

### 4.2 F1 项目扫描器技术方案

**Rust 端实现（`src-tauri/src/scanner.rs`）：**

```rust
// 核心命令
#[tauri::command]
pub fn scan_project(path: String) -> Result<ProjectFingerprint, String>;

// 模块划分
mod scanner {
    pub fn scan_structure(path) -> DirectoryTree;      // 递归遍历 + 扩展名统计
    pub fn detect_tech_stack(path) -> TechStack;       // 读 package.json/Cargo.toml 等
    pub fn parse_git_status(path) -> GitStatus;        // git status + git log
    pub fn scan_todos(path) -> Vec<TodoItem>;          // TODO/FIXME 扫描
    pub fn filter_sensitive(paths) -> Vec<PathBuf>;    // 敏感文件过滤
}
```

**白名单目录（跳过）：** `node_modules / .git / dist / build / target / __pycache__ / .next / .cache`

**敏感文件过滤（跳过）：** `.env / *.pem / *.key / *.p12 / credentials.* / secret.*`

**前端联调（`src/lib/projectScanner.ts` + `ProjectScanDashboard.tsx`）：**
- 调用 `invoke('scan_project', { path })`
- 扫描进度通过 Tauri event 实时推送
- 结果写入 `projectStore`

### 4.3 F2 上下文注入技术方案

**PromptGenerator 改造（`src/engine/PromptGenerator.ts`）：**

```typescript
// 新增 project_context 段构建
private buildProjectContext(project: ProjectFingerprint): PromptSegment {
  return {
    title: '项目上下文',
    content: [
      `技术栈：${project.tech_stack.framework} ${project.tech_stack.language}`,
      `构建工具：${project.tech_stack.build_tool}`,
      `项目类型：${project.type}`,
      `Git 分支：${project.git_status?.branch ?? '未知'}`,
    ].join('\n'),
  };
}
```

**三模式联动逻辑：**
- `ppt` 场景：项目上下文段为空（PPT 与代码项目无关）
- `frontend-ui` 场景：强化框架/构建工具/CSS 方案
- `backend-api` 场景：强化语言/框架/数据库/中间件

### 4.4 F3 进度去重技术方案

**RequirementSyncer 联动（`src/engine/RequirementSyncer.ts`）：**
- 读取项目扫描结果中的 `todos` 字段
- 将已完成的 TODO（标记为 done / removed）映射到问题 ID
- Selector 选题时排除这些问题

### 4.5 关键接口契约

```typescript
// src/types/project.ts（已存在，需扩展）
interface ProjectFingerprint {
  name: string;
  path: string;
  type: 'frontend' | 'backend' | 'fullstack' | 'other';
  tech_stack: {
    framework: string[];      // ['React', 'Tauri']
    language: string[];       // ['TypeScript', 'Rust']
    build_tool: string[];     // ['Vite', 'Cargo']
    dependencies: string[];   // 关键依赖名
  };
  structure: {
    total_files: number;
    tree: DirectoryNode;       // 简化的目录树
    extensions: Record<string, number>;  // 扩展名统计
  };
  git_status?: {
    branch: string;
    dirty: boolean;
    recent_commits: string[];  // 最近5条
  };
  todos?: TodoItem[];          // TODO/FIXME 列表
  scanned_at: string;          // ISO 时间戳
}
```

### 4.6 推荐模型（来自项目规范）

| 阶段 | 任务 | 推荐模型 | 理由 |
|---|---|---|---|
| 架构设计 | 技术方案 | GLM-5.2 | Design Arena #1 |
| Rust 开发 | 扫描器实现 | Kimi-K2.7-Code | 256K 上下文，工具调用稳 |
| 前端开发 | 仪表盘联调 | Doubao-Seed-Code | 视觉编程强 |
| 测试编写 | 单测/集成测试 | Kimi-K2.7-Code | 边界覆盖全面 |

---

## 五、目录结构

### 5.1 新增文件

```
src-tauri/src/
├── scanner.rs                    # 【新增】项目扫描器主模块
├── scanner/
│   ├── mod.rs                    # 【新增】模块入口
│   ├── structure.rs              # 【新增】文件结构扫描
│   ├── tech_stack.rs             # 【新增】技术栈识别
│   ├── git_status.rs             # 【新增】Git 状态解析
│   └── todos.rs                  # 【新增】TODO 扫描

src/
├── lib/
│   └── projectScanner.ts         # 【新增】前端扫描器封装（调用 Rust）
├── engine/
│   └── PromptGenerator.ts        # 【修改】新增 buildProjectContext 方法
├── components/
│   └── ProjectScanDashboard.tsx  # 【修改】联调真实扫描结果
├── stores/
│   └── projectStore.ts           # 【修改】扩展扫描状态管理
└── types/
    └── project.ts                # 【修改】扩展 ProjectFingerprint 类型

src-tauri/
├── Cargo.toml                    # 【修改】新增 git2 / walkdir crate
└── capabilities/                 # 【修改】新增 fs 读取权限
```

### 5.2 修改文件清单

| 文件 | 修改内容 | 涉及功能 |
|---|---|---|
| `src-tauri/src/lib.rs` | 注册 scan_project 命令 | F1.1 |
| `src-tauri/Cargo.toml` | 新增 walkdir / git2 / ignore crate | F1.2-F1.4 |
| `src/engine/PromptGenerator.ts` | 新增 buildProjectContext + 三模式联动 | F2 |
| `src/hooks/useFlow.ts` | 生成提示词时传入 project | F2 |
| `src/components/ProjectScanDashboard.tsx` | 联调真实扫描结果 | F1.5 |
| `src/stores/projectStore.ts` | 扩展 scan 状态 + 进度 | F1.5 |
| `src/types/project.ts` | 扩展 ProjectFingerprint | F1 |
| `src/engine/RequirementSyncer.ts` | 联动 todos 去重 | F3 |
| `src/engine/Selector.ts` | 过滤已完成任务问题 | F3 |

---

## 六、风险点

### 6.1 风险登记

| # | 风险 | 概率 | 影响 | 应对策略 |
|---|---|---|---|---|
| R1 | Rust 扫描器性能差（大仓库） | 中 | 中 | 增量扫描 + 进度反馈 + 超时保护（10s 强制终止） |
| R2 | Git 状态解析跨平台不一致 | 中 | 中 | 优先用 git2 crate，fallback 到命令行 `git status` |
| R3 | 敏感文件泄露到提示词 | 低 | 高 | 双重过滤（Rust 端 + 前端脱敏）+ 单测覆盖 |
| R4 | 复赛时间紧张（17天） | 高 | 中 | 严格按优先级：F1→F2→F5→F3→F4，P1 可裁剪 |
| R5 | Tauri 打包兼容性问题 | 低 | 高 | 提前打包验证，多台 Windows 机器测试 |
| R6 | 项目上下文注入导致提示词过长 | 中 | 低 | 项目上下文段限 200 字，超长自动摘要 |
| R7 | 进度去重误判（TODO 语义不准） | 中 | 中 | 去重可开关，默认关闭，用户手动开启 |

### 6.2 裁剪预案

如时间不足，按优先级裁剪：

1. **第一轮裁剪**（保 F1+F2）：砍 F3 进度去重、F4.3 视觉动效
2. **第二轮裁剪**（保 F1 核心）：砍 F1.4 Git 状态、F1.5 仪表盘联调简化
3. **保底方案**：F1.1+F1.2 基础扫描 + F2 上下文注入 + F5.1 核心单测

### 6.3 关键决策点

| 日期 | 决策 | 依据 |
|---|---|---|
| 07/28 | 扫描器是否可用？ | Rust cargo check + 前端联调 |
| 08/02 | 上下文注入是否生效？ | 端到端：扫描→生成→查看提示词 |
| 08/07 | 测试覆盖率 ≥ 75%？ | vitest 报告 |
| 08/10 | 是否达复赛提交标准？ | 功能 + 质量 + 演示材料 |

---

## 七、开发顺序

### 7.1 里程碑时间线（07/25 → 08/10，16 天，F1/F2 已完成）

```
07/25-07/26 ──── M1：F1/F2 验收 + 单测补齐 + F2.2 三模式联动（2d）
                 ├─ F1.7: scanner.rs + projectScanner.ts 单测
                 ├─ F2.2: 三模式联动差异化（PPT 弱化 / Frontend 强化 / Backend 强化）
                 ├─ F2.4: buildProjectContext 单测
                 ├─ F1/F2 端到端验收测试
                 └─ 敏感文件泄露安全审计

07/27-07/29 ──── M2：F3 进度去重（3d）
                 ├─ F3.1: RequirementSyncer 联动项目扫描（读 todos）
                 ├─ F3.2: Selector 基于已完成任务过滤
                 └─ 去重开关 UI（默认关闭）

07/30-08/01 ──── M3：F4 体验打磨（3d）
                 ├─ F4.1: 三档降级 UI（无 LLM / 本地 SLM / 云端 LLM）
                 ├─ F4.2: 错误状态 / 空状态完善
                 └─ F4.3: 视觉动效优化（可裁剪）

08/02-08/05 ──── M4：F5 质量加固（4d）
                 ├─ F5.1: seedRouter + RequirementSyncer 单测
                 ├─ F5.2: 集成测试（输入→提问→生成→复制 全流程）
                 ├─ F5.3: 问题库扩充（31→60+）
                 └─ 覆盖率报告 ≥ 75%

08/06-08/10 ──── M5：收尾 + 提交（5d，含 2d 缓冲）
                 ├─ 全流程联调（三模式 × 项目上下文 × 进度去重）
                 ├─ 性能/安全测试
                 ├─ 复赛帖 + 演示视频
                 ├─ 冻结 + 签名打包
                 └─ 多台 Windows 机器验证
```

**缓冲说明**：原 17 天计划中 M1（5d）+ M2（3d）= 8 天的工作已提前完成，现实际剩余工作约 12 天，M5 预留 2 天缓冲应对突发问题。

### 7.2 任务依赖图（更新后）

```
✅ F1.1-F1.6 (扫描器已完成)
✅ F2.1 (上下文注入已完成)
         │
         ▼
⏳ M1: F1.7 单测 + F2.2 三模式联动 + F2.4 单测 + 端到端验收
         │
         ▼
⏳ M2: F3.1 (RequirementSyncer 联动) ──→ F3.2 (Selector 过滤)
         │
         ▼
⏳ M3: F4.1 (三档降级) | F4.2 (错误状态) | F4.3 (动效-可裁)
         │
         ▼
⏳ M4: F5.1 (单测) | F5.2 (集成测试) | F5.3 (问题库)
         │
         ▼
⏳ M5: 收尾 + 提交
```

### 7.3 优先级矩阵（更新后）

| 功能 | 价值 | 工时 | 优先级 | 必做？ | 状态 |
|---|---|---|---|---|---|
| ~~F1 项目扫描器~~ | 极高（全生命周期基础） | ~~5d~~ | P0 | ✅ | ✅ 已完成 |
| ~~F2.1 上下文注入~~ | 高（提示词质量提升） | ~~2d~~ | P0 | ✅ | ✅ 已完成 |
| F2.2 三模式联动 | 中（差异化体验） | 1d | P0 | ✅ | ⏳ 待做 |
| F1.7+F2.4 单测补齐 | 高（质量保障） | 1d | P0 | ✅ | ⏳ 待做 |
| F5.1 单测补齐 | 高（质量保障） | 1d | P0 | ✅ | ⏳ 待做 |
| F5.2 集成测试 | 中（稳定性） | 1d | P0 | ✅ | ⏳ 待做 |
| F3 进度去重 | 中（体验优化） | 2d | P1 | 🔶 | ⏳ 待做 |
| F4.1 三档降级 | 中（体验清晰） | 1d | P1 | 🔶 | ⏳ 待做 |
| F4.2 错误状态 | 低（兜底体验） | 1d | P1 | 🔶 | ⏳ 待做 |
| F4.3 视觉动效 | 低（锦上添花） | 1d | P2 | ❌ | 可砍 |
| F5.3 问题库扩充 | 低（覆盖度） | 1d | P1 | 🔶 | ⏳ 待做 |

---

## 八、验收标准

### 8.1 复赛提交验收清单

**Must Have（必须达成）：**
- [x] ~~F1：项目扫描器可用，输入路径 → 输出结构化指纹~~ ✅ 已完成
- [x] ~~F2：提示词 100% 包含项目上下文段（有项目时）~~ ✅ 已完成
- [ ] F1/F2 单测覆盖（scanner.rs + projectScanner.ts + buildProjectContext）
- [ ] F2.2 三模式联动差异化（PPT 弱化 / Frontend 强化 / Backend 强化）
- [ ] 核心闭环稳定：唤起 → 提问 → 生成 → 复制，全流程无报错
- [ ] 测试覆盖率 ≥ 75%
- [ ] 安装包可正常安装运行（≤ 20MB）

**Nice to Have（加分项）：**
- [ ] F3：进度去重生效
- [ ] F4.1：三档降级体验清晰
- [ ] 问题库 60+ 条
- [ ] 演示视频 + 复赛帖完整

### 8.2 性能指标

| 指标 | 目标值 | 测量方式 |
|---|---|---|
| 项目扫描（1000文件） | < 10s | 计时器 |
| 提示词生成（含项目上下文） | < 2s | 计时器 |
| 启动时间 | < 2s | 进程启动到悬浮球 |
| 内存占用 | ≤ 200MB | 任务管理器 |
| 包体大小 | ≤ 20MB | 安装包文件 |

---

## 九、总结

**一句话方向**：F1（扫描器）+ F2（上下文注入）已提前完成，剩余 16 天聚焦"F1/F2 验收 + F3 进度去重 + F4 体验打磨 + F5 质量加固"，让灵感大王从"单次提示词工具"稳定升级为"项目伴随助手"。

**核心取舍**：
- ✅ F1/F2 已完成，需补单测和三模式联动差异化
- 🔶 F3（去重）+ F4（打磨）视进度裁剪
- ❌ F4.3（动效）可砍

**关键风险**：F1/F2 缺少测试保障是最大隐患，M1 优先补齐单测和端到端验收。

---

*本文档基于 2026-07-25 项目现状产出（v1.1 修正版），已同步 F1/F2 完成状态，等待主理人确认后进入任务级实现计划阶段。*
