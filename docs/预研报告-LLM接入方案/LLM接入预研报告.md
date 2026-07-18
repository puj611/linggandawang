# 灵感大王 LLM 接入预研报告

> 日期：2026-07-07 | 项目截止：2026-07-22 | 剩余：15 天
> 核心卡点：LLM 适配器已建好但未接入业务流程，提示词生成 100% 走规则引擎

---

## 第一部分：三种实现方案对比

### 方案 A：LLM 后处理增强（规则生成 → LLM 重写）

**思路**：保持现有 PromptGenerator 规则引擎不变，在其产出 `PromptResult` 后，调用 LLM 对五段内容做"语义润色 + 细节扩展"。

```
用户输入 → QuestionEngine → PromptGenerator(规则) → PromptResult(草稿)
  → LLM 重写每段内容 → PromptResult(最终) → 展示
```

**优点**：
- 改动面最小，只需在 `useFlow.finishAndGenerate()` 末尾加一步 LLM 调用
- 规则引擎作为安全底座，LLM 失败可直接用草稿结果
- 不破坏现有 31 题问题库和评价词典逻辑
- 可以按段粒度控制：只增强 action/spec 段，constraint/verify 段保持规则

**缺点**：
- 两次生成（规则 + LLM），总延迟增加 2-5 秒
- LLM 重写可能丢失规则引擎精心构建的结构化信息（如 WCAG 数值、项目约定）
- Token 消耗较高（输入草稿全文 + 输出重写全文）
- 语义提升有限——本质是"润色"而非"理解"

**风险点**：
- LLM 可能不遵守输出格式约定，需要强 System Prompt 约束
- 段落间一致性可能被破坏（action 说做 A，spec 里变成 B）
- 超时风险：5 段串行调用 LLM，总耗时可能超 30 秒

**核心 Demo 代码**：

```typescript
// src/engine/LLMEnhancer.ts
import type { PromptResult } from '@/types/prompt';
import type { LLMAdapter, LLMRequest } from '@/lib/llm/types';

const SYSTEM_PROMPT = `你是一个提示词优化专家。
输入是一份结构化提示词草稿（JSON），包含 action/spec/constraint/verify 四段。
请逐段优化：保持原意不变，增强语义精确度、补充实施细节、确保段间一致。
输出格式：与输入相同的 JSON 结构，不添加任何额外字段。`;

export class LLMEnhancer {
  constructor(private adapter: LLMAdapter, private apiKey: string, private baseUrl: string) {}

  async enhance(draft: PromptResult, model: string): Promise<PromptResult> {
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({
          action: draft.action.content,
          spec: draft.spec.content,
          constraint: draft.constraint.content,
          verify: draft.verify.content,
        })},
      ],
      model,
      temperature: 0.3, // 低温度保稳定性
      max_tokens: 2000,
    };

    const resp = await this.adapter.chat(request, this.apiKey, this.baseUrl);
    const enhanced = JSON.parse(resp.content);

    return {
      ...draft,
      action:   { ...draft.action,   content: enhanced.action   ?? draft.action.content },
      spec:     { ...draft.spec,     content: enhanced.spec     ?? draft.spec.content },
      constraint:{ ...draft.constraint, content: enhanced.constraint ?? draft.constraint.content },
      verify:   { ...draft.verify,   content: enhanced.verify   ?? draft.verify.content },
    };
  }
}

// useFlow.ts 中的接入点
const finishAndGenerate = useCallback(async () => {
  const engine = getEngine();
  const snap = engine.snapshot();
  const draft = promptGenerator.generate({ /* ... */ }); // 规则引擎生成草稿
  setResult(draft); // 先展示草稿，避免白屏

  // LLM 增强（可选，失败则保留草稿）
  const config = useApiKeyStore.getState().config;
  if (config) {
    try {
      const apiKey = await useApiKeyStore.getState().getApiKey();
      if (apiKey) {
        const adapter = getAdapter(config.provider);
        const enhancer = new LLMEnhancer(adapter, apiKey, config.baseUrl);
        const enhanced = await enhancer.enhance(draft, config.model);
        setResult(enhanced); // 用增强版替换
      }
    } catch (e) {
      console.warn('[useFlow] LLM enhance failed, using draft', e);
      // 保留草稿，不抛错
    }
  }
  transition('result');
}, []);
```

---

### 方案 B：LLM 直驱生成（规则引擎降级为 Fallback）

**思路**：当用户配置了 API Key 时，直接用 LLM 生成提示词全文；规则引擎仅在 LLM 不可用时降级使用。

```
用户输入 → 检查 API Key
  ├─ 有 Key → LLM 生成（System Prompt 注入规则引擎的结构化知识）
  └─ 无 Key → PromptGenerator(规则) 生成
```

**优点**：
- 语义理解能力最强——LLM 能理解"太挤"背后的真实意图
- 提示词质量上限高，能生成规则引擎无法产出的创意表述
- 单次调用，延迟可控（1-3 秒）
- 用户无 Key 时仍有规则引擎兜底，产品不会不可用

**缺点**：
- LLM 输出不稳定，需要严格的格式约束和解析容错
- 依赖外部服务，网络波动直接影响核心体验
- 规则引擎的知识（评价词典、项目约定）需要翻译成 System Prompt，token 成本高
- "有 Key"和"无 Key"用户体验差异大，评测/演示时不好控制

**风险点**：
- LLM 输出 JSON 解析失败率约 5-10%，需要重试或降级机制
- 不同服务商（DeepSeek vs OpenAI vs 通义）输出风格差异大
- System Prompt 可能被注入攻击绕过（用户输入中嵌入恶意指令）
- 成本不可控：每次生成消耗 1000-3000 token

**核心 Demo 代码**：

```typescript
// src/engine/LLMGenerator.ts
import type { PromptResult } from '@/types/prompt';
import type { IntentTag, Answer } from '@/types/state';
import type { ProjectFingerprint } from '@/types/project';
import type { LLMAdapter, LLMRequest } from '@/lib/llm/types';

const SYSTEM_PROMPT = `你是"灵感大王"提示词生成引擎。
根据用户的种子输入、问答记录和意图标签，生成一份结构化提示词。

输出格式（严格 JSON）：
{
  "action": "要做什么：一句话描述目标",
  "spec": "怎么做：3-5 条具体规格，含量化指标",
  "constraint": "不能怎么：2-3 条硬约束",
  "verify": "怎么算做好了：2-3 条可验证的验收标准"
}

规则：
1. 每段必须以"标题："开头
2. 规格段必须包含量化指标（像素值、毫秒数、百分比等）
3. 约束段必须与项目技术栈一致
4. 全部用中文输出`;

export class LLMGenerator {
  constructor(
    private adapter: LLMAdapter,
    private apiKey: string,
    private baseUrl: string,
  ) {}

  async generate(input: {
    seedInput: string;
    answers: Record<string, Answer>;
    intentTags: IntentTag[];
    project?: ProjectFingerprint | null;
  }, model: string): Promise<PromptResult> {
    const userContent = this.buildUserPrompt(input);
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      model,
      temperature: 0.4,
      max_tokens: 1500,
    };

    const resp = await this.adapter.chat(request, this.apiKey, this.baseUrl);

    // 容错解析：LLM 可能输出非标准 JSON
    const parsed = this.safeParse(resp.content);
    if (!parsed) {
      throw new Error('LLM 输出格式异常，无法解析');
    }

    const now = new Date().toISOString();
    return {
      project_context: input.project ? this.buildProjectCtx(input.project) : null,
      action:      { title: '要做什么', content: parsed.action },
      spec:        { title: '怎么做', content: parsed.spec },
      constraint:  { title: '不能怎么', content: parsed.constraint },
      verify:      { title: '怎么算做好了', content: parsed.verify },
      raw_quotes: [],
      intent_tags: input.intentTags,
      generated_at: now,
      project: input.project ?? undefined,
    };
  }

  private buildUserPrompt(input: {
    seedInput: string;
    answers: Record<string, Answer>;
    intentTags: IntentTag[];
    project?: ProjectFingerprint | null;
  }): string {
    const lines: string[] = [];
    lines.push(`## 种子输入\n${input.seedInput}`);
    if (input.intentTags.length > 0) {
      lines.push(`## 意图标签\n${input.intentTags.map(t => `- ${t.label}`).join('\n')}`);
    }
    const answers = Object.values(input.answers).filter(a => a.value);
    if (answers.length > 0) {
      lines.push(`## 问答记录\n${answers.map(a => `Q: ${a.questionText ?? ''}\nA: ${a.raw ?? a.value}`).join('\n\n')}`);
    }
    if (input.project) {
      lines.push(`## 项目上下文\n框架: ${input.project.framework}\nCSS: ${input.project.cssSolution}`);
    }
    return lines.join('\n\n');
  }

  private safeParse(content: string): { action: string; spec: string; constraint: string; verify: string } | null {
    // 尝试直接 JSON.parse
    try { return JSON.parse(content); } catch {}
    // 尝试提取 JSON 块
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }

  private buildProjectCtx(p: ProjectFingerprint) {
    return { title: '项目上下文', content: `框架: ${p.framework}, CSS: ${p.cssSolution}` };
  }
}

// useFlow.ts 中的接入点
const finishAndGenerate = useCallback(async () => {
  const engine = getEngine();
  const snap = engine.snapshot();

  // 检查是否可以走 LLM 路径
  const config = useApiKeyStore.getState().config;
  const hasKey = useApiKeyStore.getState().hasApiKey;

  if (config && hasKey) {
    try {
      const apiKey = await useApiKeyStore.getState().getApiKey();
      if (apiKey) {
        const adapter = getAdapter(config.provider);
        const generator = new LLMGenerator(adapter, apiKey, config.baseUrl);
        const result = await generator.generate({
          seedInput: snap.seedInput,
          answers: snap.answers,
          intentTags: snap.intentTags,
          project: projectFingerprint,
        }, config.model);
        setResult(result);
        transition('result');
        return;
      }
    } catch (e) {
      console.warn('[useFlow] LLM generate failed, falling back to rules', e);
      // 降级到规则引擎
    }
  }

  // 规则引擎 fallback
  const draft = promptGenerator.generate({ /* ... */ });
  setResult(draft);
  transition('result');
}, []);
```

---

### 方案 C：混合模式（规则建骨架 + LLM 填血肉）

**思路**：规则引擎负责结构骨架和项目特定约束（不变部分），LLM 负责语义扩展和个性化表述（可变部分）。两者并行生成，最终合并。

```
用户输入 → 规则引擎生成骨架（结构 + 项目约束 + WCAG 数值）
         → LLM 生成语义扩展（场景描述 + 实施细节 + 验收标准）
         → Merger 合并：规则段优先，LLM 补充
```

**优点**：
- 结构稳定性 + 语义丰富性兼顾
- 项目特定信息（框架约定、CSS 方案）由规则引擎保证准确
- LLM 只生成"可变部分"，token 消耗降低 40-60%
- 即使 LLM 失败，骨架仍是完整可用的提示词
- 可按段精细控制哪些走规则、哪些走 LLM

**缺点**：
- 实现复杂度最高——需要设计 Merger 合并逻辑
- 需要明确划分"规则段"和"LLM 段"的边界
- 合并时可能出现内容重复或矛盾
- 开发周期最长（预计 3-4 天）

**风险点**：
- Merger 逻辑的边界情况处理（LLM 输出包含项目约束怎么办？）
- 并行调用时规则引擎同步、LLM 异步，需要 Promise 管理
- 调试困难——最终输出是两个引擎混合的产物

**核心 Demo 代码**：

```typescript
// src/engine/HybridGenerator.ts
import { PromptGenerator } from './PromptGenerator';
import type { PromptResult, PromptSegment } from '@/types/prompt';
import type { IntentTag, Answer } from '@/types/state';
import type { ProjectFingerprint } from '@/types/project';
import type { LLMAdapter, LLMRequest } from '@/lib/llm/types';

// 每段的生成策略
type SegmentStrategy = 'rule' | 'llm' | 'merge';

const SEGMENT_STRATEGY: Record<string, SegmentStrategy> = {
  action: 'llm',        // 动作段：LLM 生成（语义理解强）
  spec: 'merge',        // 规格段：规则给骨架 + LLM 补细节
  constraint: 'rule',   // 约束段：规则生成（项目硬红线，不能让 LLM 改）
  verify: 'llm',        // 验证段：LLM 生成（验收标准需要语义理解）
};

const LLM_SEGMENT_PROMPT = `你是一个提示词片段生成器。
根据上下文，为指定段落生成内容。只输出该段落内容，不要输出标题。
要求：具体、可执行、包含量化指标。全部用中文。`;

export class HybridGenerator {
  private ruleGenerator: PromptGenerator;
  private adapter: LLMAdapter | null = null;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    ruleGenerator: PromptGenerator,
    adapter: LLMAdapter | null,
    apiKey: string,
    baseUrl: string,
    model: string,
  ) {
    this.ruleGenerator = ruleGenerator;
    this.adapter = adapter;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async generate(input: {
    seedInput: string;
    answers: Record<string, Answer>;
    intentTags: IntentTag[];
    project?: ProjectFingerprint | null;
  }): Promise<PromptResult> {
    // 1. 规则引擎生成完整骨架（同步，立即可用）
    const skeleton = this.ruleGenerator.generate(input);

    // 无 LLM 适配器，直接返回骨架
    if (!this.adapter) return skeleton;

    // 2. 对需要 LLM 的段落异步生成
    const llmTasks: Promise<{ key: string; content: string }>[] = [];

    for (const [key, strategy] of Object.entries(SEGMENT_STRATEGY)) {
      if (strategy === 'rule') continue;

      const ruleContent = skeleton[key as keyof PromptResult] as PromptSegment;
      const prompt = this.buildSegmentPrompt(key, strategy, ruleContent.content, input);

      llmTasks.push(
        this.adapter.chat(
          { messages: [
            { role: 'system', content: LLM_SEGMENT_PROMPT },
            { role: 'user', content: prompt },
          ], model: this.model, temperature: 0.4, max_tokens: 500 },
          this.apiKey, this.baseUrl,
        ).then(resp => ({ key, content: resp.content }))
         .catch(() => ({ key, content: ruleContent.content })) // 失败降级
      );
    }

    // 3. 等待所有 LLM 段完成（并行，取最慢的一个）
    const llmResults = await Promise.all(llmTasks);

    // 4. 合并
    const merged = { ...skeleton };
    for (const { key, content } of llmResults) {
      const segment = merged[key as keyof PromptResult] as PromptSegment;
      const strategy = SEGMENT_STRATEGY[key];
      if (strategy === 'llm') {
        // LLM 段：直接替换
        merged[key as keyof PromptResult] = { ...segment, content };
      } else if (strategy === 'merge') {
        // 合并段：规则内容在前，LLM 补充在后
        merged[key as keyof PromptResult] = {
          ...segment,
          content: `${segment.content}\n\n${content}`,
        };
      }
    }

    return merged;
  }

  private buildSegmentPrompt(
    key: string,
    strategy: string,
    ruleContent: string,
    input: { seedInput: string; intentTags: IntentTag[]; answers: Record<string, Answer> },
  ): string {
    const parts: string[] = [];
    parts.push(`种子输入：${input.seedInput}`);
    if (input.intentTags.length > 0) {
      parts.push(`意图标签：${input.intentTags.map(t => t.label).join('、')}`);
    }
    if (strategy === 'merge') {
      parts.push(`已有的规则生成内容（在此基础上补充细节，不要重复已有内容）：\n${ruleContent}`);
    }
    const labelMap: Record<string, string> = {
      action: '动作段（要做什么）',
      spec: '规格段（怎么做）',
      verify: '验证段（怎么算做好了）',
    };
    parts.push(`请生成：${labelMap[key] ?? key}`);
    return parts.join('\n\n');
  }
}
```

---

### 方案对比总表

| 维度 | 方案 A（LLM 后处理） | 方案 B（LLM 直驱） | 方案 C（混合模式） |
|---|---|---|---|
| **改动量** | 小（1 个新文件 + 1 处接入） | 中（1 个新文件 + 1 处接入 + 降级逻辑） | 大（1 个新文件 + Merger + 策略配置） |
| **语义质量** | 中（润色级别） | 高（完全理解） | 高（关键段理解 + 骨架稳定） |
| **稳定性** | 高（规则兜底） | 中（依赖降级机制） | 高（规则骨架始终在） |
| **Token 成本** | 高（全文重写） | 中（单次生成） | 低（只生成可变段） |
| **延迟** | 高（规则 + LLM 串行） | 低（单次 LLM） | 中（并行，取最慢段） |
| **开发周期** | 1-2 天 | 2-3 天 | 3-4 天 |
| **推荐度** | ⭐⭐⭐ 短期过渡 | ⭐⭐⭐⭐ 长期目标 | ⭐⭐⭐⭐⭐ 最佳平衡 |

**推荐**：考虑到剩余 15 天的工期和大赛评审时间压力，**建议先用方案 A 快速验证 LLM 接入可行性（2 天），再视效果决定是否升级到方案 C（3 天）**。方案 B 作为长期演进方向，不在本次大赛周期内实施。

---

## 第二部分：同类项目预研报告

### 1. AIPRM（浏览器插件，500万+ 用户）

**实现思路**：
- 纯模板驱动，不调用 LLM 生成提示词
- 社区贡献模板库（2000+ 模板），按场景分类
- 用户选择模板 → 填入变量 → 复制到 ChatGPT
- 1-click prompt 功能：根据用户对话上下文自动推荐模板

**踩坑点**：
- 模板质量参差不齐，需要社区投票机制过滤
- 变量替换容易出错（用户填入特殊字符）
- 完全依赖外部 LLM 平台，无自有生成能力

**对灵感大王的启发**：
- 模板分类思路可借鉴（按场景/角色/复杂度分类）
- 变量替换需要做转义处理
- 但我们的核心差异是"交互式问答生成"，不是静态模板

### 2. PromptBox（提示词管理平台）

**实现思路**：
- 提示词 CRUD + 分类管理 + 快捷键粘贴
- `/shortcuts` 命令系统：输入 `/` + 关键词快速插入提示词片段
- 团队协作：共享提示词库
- 无 LLM 生成能力，纯人工编写 + 管理

**踩坑点**：
- 快捷键全局注入与目标应用冲突
- 大量提示词时搜索效率下降
- 缺少版本管理，团队协作时容易覆盖

**对灵感大王的启发**：
- 快捷键粘贴思路已有（全局热键 Alt+Shift+Space）
- 可考虑增加"提示词片段库"功能，用户保存常用片段
- 版本管理：当前已有 prompt_history 表，可扩展为版本对比

### 3. OpenAI Meta-Prompt（OpenAI 官方提示词生成工具）

**实现思路**：
- 用 LLM 生成提示词（meta-prompting）
- 输入：任务描述 → 输出：结构化提示词
- 多轮迭代：生成 → 测试 → 优化 → 再生成
- System Prompt 中嵌入"提示词工程最佳实践"知识库

**踩坑点**：
- 生成的提示词过于通用，缺乏领域特异性
- 多轮迭代消耗大量 token
- 用户难以判断生成质量（需要实际测试）

**对灵感大王的启发**：
- 我们的 QuestionEngine 正好解决了"过于通用"问题——31 题问答收集领域上下文
- 评价词典的 `expandToSpecs` 就是把模糊词展开成量化指标，比纯 LLM 更可控
- 可借鉴"生成 → 测试 → 优化"闭环思路，但当前周期内不实施

### 4. FlowGPT（社区提示词分享平台）

**实现思路**：
- 社区驱动的提示词排行榜
- 每个提示词附带"模型 + 参数 + 效果评分"
- 用户可以直接在平台上测试提示词效果
- 数据驱动：通过用户评分数据训练提示词优化模型

**踩坑点**：
- 评分主观性强，同一提示词不同人评价差异大
- 模型升级后旧提示词效果变化（GPT-3.5 → GPT-4 提示词风格不同）
- 平台测试环境与用户实际使用环境差异大

**对灵感大王的启发**：
- 提示词效果评分：可在结果页增加"这个提示词效果如何？"反馈按钮
- 模型适配：当前已支持 4 个服务商，需注意不同模型的提示词风格差异

### 5. Tauri + Ollama 本地 AI 桌面端方案（社区实战案例）

**实现思路**：
- Tauri 前端通过 `invoke` 调用 Rust 后端
- Rust 后端用 `reqwest` 调用本地 Ollama API（localhost:11434）
- 流式响应通过 Tauri Event 传递到前端
- 前端用 `listen` 监听事件，实时渲染流式输出

**踩坑点**：
- Tauri 的 CSP 策略默认阻止外部 HTTP 请求，需要在 `tauri.conf.json` 中配置 `allowlist`
- 流式响应通过 Event 传递有延迟（约 50-100ms/块），不如直接 fetch SSE 流畅
- Rust 端 `reqwest` 需要开启 `stream` feature
- 本地 Ollama 模型加载慢（首次调用 5-10 秒）

**对灵感大王的启发**：
- 当前架构是前端 `fetch` 直接调 LLM API，绕过 Rust 后端——更简单但 CSP 需要配置
- 如果未来要支持本地模型（Ollama），需要 Rust 端做代理
- 流式输出：当前 `chatStream` 已实现 SSE 解析，但未在 UI 中使用

### 6. 生产级 LLM 熔断降级模式（CSDN 技术博客 + 工程实践）

**实现思路**：
- 三态熔断器：Closed（正常）→ Open（熔断，直接降级）→ Half-Open（探测恢复）
- 降级策略链：LLM → 规则引擎 → 兜底模板
- 指数退避重试：1s → 2s → 4s，最多 3 次
- 错误分类：网络错误（重试）/ 限流（等待）/ 参数错误（不重试）/ 服务端错误（降级）

**踩坑点**：
- 熔断器状态在前端不好持久化（刷新丢失），需要 localStorage 或后端存储
- Half-Open 状态的探测请求可能影响用户体验（用户不知道在探测）
- 重试期间用户无法操作，需要明确的 UI 反馈
- 指数退避在短时间窗口内可能导致请求堆积

**对灵感大王的启发**：
- 熔断器可以简化为"连续失败计数 + 冷却期"，不需要完整状态机
- 降级链：LLM → 规则引擎（已有）→ 兜底提示词（可预置几条通用模板）
- 重试限制 2 次（1s + 2s），避免用户等待过久
- 错误分类已在 `openai-adapter.ts` 中部分实现（AbortError 识别）

---

### 同类项目对比总结

| 项目 | 生成方式 | LLM 依赖 | 交互方式 | 灵感大王差异点 |
|---|---|---|---|---|
| AIPRM | 纯模板 | 无 | 选模板+填变量 | 我们是问答交互式生成 |
| PromptBox | 人工编写 | 无 | 管理+快捷键 | 我们是自动生成 |
| OpenAI Meta-Prompt | LLM 直驱 | 强依赖 | 单轮描述 | 我们有 31 题多轮收集 |
| FlowGPT | 社区贡献 | 无 | 浏览+测试 | 我们是私有化本地工具 |
| Tauri+Ollama | LLM 本地 | 强依赖 | 对话式 | 我们是提示词生成器 |

**核心结论**：灵感大王的"交互式问答 + 规则引擎 + LLM 增强"组合在同类产品中是差异化的。大多数工具要么纯模板、要么纯 LLM，我们的混合模式如果实现得当，能在"可控性"和"智能性"之间取得独特平衡。

---

## 第三部分：核心卡点分步验证清单

### 卡点 1：LLM 调用链路是否通畅

**验证目标**：确认前端 → LLM API 的请求能成功发出并返回

| 步骤 | 操作 | 预期结果 | 验证方法 |
|---|---|---|---|
| 1.1 | 打开设置页，配置 DeepSeek API Key | "已设置"状态显示绿色 | 点击"测试连接"按钮，显示"连接成功 ✓" |
| 1.2 | 在浏览器 DevTools Console 执行模拟调用 | 返回非空 content | `fetch('https://api.deepseek.com/v1/chat/completions', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer sk-xxx'}, body:JSON.stringify({model:'deepseek-chat',messages:[{role:'user',content:'hello'}]})}).then(r=>r.json()).then(console.log)` |
| 1.3 | 在 `useFlow.finishAndGenerate` 中加 `console.log` 确认 apiKey 非空 | Console 输出 apiKey 长度 > 10 | 临时加 `console.log('[debug] apiKey len:', apiKey?.length)` |
| 1.4 | 确认 Tauri CSP 允许外部请求 | 无 CSP 拦截错误 | 检查 `src-tauri/tauri.conf.json` 中 `security.csp` 是否包含 `connect-src https://api.deepseek.com` |

**本地验证命令**：
```powershell
# 检查 CSP 配置
Get-Content src-tauri/tauri.conf.json | Select-String "csp"
# 检查 LLM 适配器是否正确导出
Get-Content src/lib/llm/index.ts
```

### 卡点 2：LLM 输出格式是否可控

**验证目标**：LLM 返回的内容能被正确解析为 PromptResult 结构

| 步骤 | 操作 | 预期结果 | 验证方法 |
|---|---|---|---|
| 2.1 | 编写 System Prompt，要求输出 JSON | LLM 返回合法 JSON | 在 DevTools 中手动调用 `adapter.chat()` 并 `console.log` 结果 |
| 2.2 | 测试 `JSON.parse` 成功率 | 10 次中至少 8 次成功 | 写一个 vitest 测试用例，调用 10 次，统计成功率 |
| 2.3 | 测试 `safeParse` 容错（提取 JSON 块） | 能从 markdown 代码块中提取 JSON | 构造 ` ```json {...} ``` ` 格式的测试输入 |
| 2.4 | 测试段间一致性 | action 和 spec 描述的是同一件事 | 人工检查 5 次生成结果 |

**本地验证脚本**（保存到 `python库/llm_format_test.mjs`）：
```javascript
// 用 node 执行：node python库/llm_format_test.mjs
const SYSTEM = `输出严格 JSON：{"action":"...","spec":"...","constraint":"...","verify":"..."}`;
const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-YOUR-KEY' },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: '帮我写一个登录页面' }],
    temperature: 0.3,
  }),
});
const data = await resp.json();
const content = data.choices[0].message.content;
console.log('Raw:', content);
try {
  const parsed = JSON.parse(content);
  console.log('Parsed OK:', Object.keys(parsed));
} catch {
  const match = content.match(/\{[\s\S]*\}/);
  if (match) { console.log('Extracted:', JSON.parse(match[0])); }
  else { console.log('PARSE FAILED'); }
}
```

### 卡点 3：降级机制是否可靠

**验证目标**：LLM 失败时能正确降级到规则引擎，用户无感知

| 步骤 | 操作 | 预期结果 | 验证方法 |
|---|---|---|---|
| 3.1 | 断网后执行"直接生成" | 3 秒内降级到规则引擎，展示提示词 | 计时从点击到结果展示 |
| 3.2 | 输入错误的 API Key 后生成 | 显示错误提示但仍有规则引擎结果 | 检查 ErrorBanner 是否展示 + ResultPanel 是否有内容 |
| 3.3 | LLM 返回超时（>30s） | AbortController 触发，降级到规则 | 临时把 timeout 改为 3 秒测试 |
| 3.4 | LLM 返回非 JSON 内容 | safeParse 返回 null，降级到规则 | 构造 mock 返回 `"我无法生成"` 纯文本 |

**本地验证方法**：
```powershell
# 运行单元测试（如果有的话）
npm run test -- --grep "LLM"
# 手动验证：修改 apiKey 为无效值，观察降级行为
```

### 卡点 4：用户体验是否流畅

**验证目标**：LLM 增强模式下用户不会感到"卡顿"

| 步骤 | 操作 | 预期结果 | 验证方法 |
|---|---|---|---|
| 4.1 | 规则引擎生成后立即展示草稿 | 点击"开始提问"后 < 1 秒进入结果页 | 计时 |
| 4.2 | LLM 增强完成后无缝替换 | 草稿内容平滑过渡为增强版 | 观察是否有闪烁/跳动 |
| 4.3 | 展示"AI 增强中…"提示 | Spinner 或文字提示用户正在增强 | 检查 ResultPanel 顶部是否有加载指示 |
| 4.4 | 增强 vs 草稿对比 | 用户能看出增强版更好 | 人工对比 5 组结果 |

### 卡点 5：CSP 与网络安全配置

**验证目标**：Tauri 打包后 LLM 请求不会被 CSP 拦截

| 步骤 | 操作 | 预期结果 | 验证方法 |
|---|---|---|---|
| 5.1 | 检查 `tauri.conf.json` 的 CSP 配置 | `connect-src` 包含所有 LLM API 域名 | `Get-Content src-tauri/tauri.conf.json \| Select-String "csp"` |
| 5.2 | 开发模式下测试 LLM 调用 | 无 CSP 错误 | DevTools Console 检查无 CSP violation |
| 5.3 | 打包后测试 LLM 调用 | 无 CSP 错误 | `npm run tauri build` 后安装测试 |
| 5.4 | 测试多个服务商 | DeepSeek/OpenAI/通义都能调通 | 分别配置 3 个 Key 测试 |

**需要添加的 CSP 配置**（如果当前没有）：
```json
// tauri.conf.json → security.csp
"csp": "default-src 'self'; connect-src 'self' https://api.deepseek.com https://api.openai.com https://dashscope.aliyuncs.com; ..."
```

---

### 回到本地后的验证流程（按顺序执行）

```
1. [ ] npm run dev 启动开发服务器
2. [ ] 打开设置页，配置 DeepSeek API Key，点击"测试连接"
3. [ ] 确认 Console 无 CSP 错误
4. [ ] 输入"帮我做一个登录页面"，选择"直接生成"模式
5. [ ] 确认 3 秒内进入结果页（规则引擎草稿）
6. [ ] 确认 LLM 增强完成后内容有变化（如果接入了增强）
7. [ ] 断网后重复步骤 4，确认降级到规则引擎
8. [ ] 输入空内容，确认有错误提示
9. [ ] 输入超长内容（>5000 字符），确认有长度限制提示
10. [ ] npm run build 确认无编译错误
11. [ ] cargo check 确认后端无编译错误
12. [ ] （可选）npm run tauri build 打包测试
```

---

## 附录：关键文件索引

| 文件 | 作用 | 本次改动涉及 |
|---|---|---|
| [useFlow.ts](file:///d:/AI工作平台/linggandawang/src/hooks/useFlow.ts) | 主流程编排，LLM 接入点 | `finishAndGenerate()` |
| [PromptGenerator.ts](file:///d:/AI工作平台/linggandawang/src/engine/PromptGenerator.ts) | 规则引擎生成器 | 不改动（作为 fallback） |
| [openai-adapter.ts](file:///d:/AI工作平台/linggandawang/src/lib/llm/openai-adapter.ts) | LLM 适配器 | 不改动（已就绪） |
| [types.ts](file:///d:/AI工作平台/linggandawang/src/lib/llm/types.ts) | LLM 接口定义 | 不改动 |
| [apiKeyStore.ts](file:///d:/AI工作平台/linggandawang/src/stores/apiKeyStore.ts) | API Key 管理 | 不改动（已就绪） |
| [featureStore.ts](file:///d:/AI工作平台/linggandawang/src/stores/featureStore.ts) | 功能开关 | 新增 `llmEnhance` 开关 |
| [tauri.conf.json](file:///d:/AI工作平台/linggandawang/src-tauri/tauri.conf.json) | Tauri 配置 | 检查 CSP |
| **新增** LLMEnhancer.ts / LLMGenerator.ts / HybridGenerator.ts | LLM 生成器 | 按方案创建 |

---

*报告结束。建议优先执行方案 A（LLM 后处理增强），2 天内完成接入和验证。*
