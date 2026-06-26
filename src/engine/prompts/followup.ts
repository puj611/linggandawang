// src/engine/prompts/followup.ts
// 动态追问 LLM 提示词模板
// 在 SmartFollowup 触发条件命中时，调用 LLM 生成一道个性化追问题

import type { ChatMessage } from '@/lib/llm/types';

/** 追问触发原因（用于在 prompt 中给 LLM 上下文） */
export type FollowupTrigger =
  | 'high-ambiguity' // LLM 分析时 ambiguity_score > 0.6
  | 'consecutive-custom' // 用户连续 N 次选择"自定义输入"而非选项
  | 'stage-transition-with-skip'; // 阶段切换且本阶段至少一题被跳过

/** 追问 LLM 输入 */
export interface FollowupPromptInput {
  seed: string;
  trigger: FollowupTrigger;
  currentQuestionText?: string;
  currentStage?: string;
  userAnswer?: string;
  /** LLM 之前给的 suggested_followup（来自 intent-analysis） */
  suggestedFollowup?: string | null;
  /** LLM 之前给的 followup_options */
  followupOptions?: string[];
  /** 最近问答历史 */
  recentQA?: Array<{ question: string; answer: string }>;
}

/** 追问 LLM 期望输出（结构化 JSON） */
export interface FollowupLLMOutput {
  question_text: string;
  why: string;
  options: Array<{ label: string; target_tag: string }>;
  allow_custom: boolean;
  placeholder?: string;
}

/**
 * 系统提示词：定义 LLM 角色（灵感大王的动态追问引擎）
 */
export function buildSystemPrompt(): string {
  return `你是「灵感大王」的动态追问引擎。任务：在用户回答某题后，根据上下文生成一道**精准、个性化**的追问，帮助用户进一步澄清意图或挖掘深层需求。

追问设计原则：
1. **针对性**：必须基于用户刚才的回答 + 当前阶段，不要泛泛而问
2. **递进性**：在用户已表达的信息上深挖，而非重复询问
3. **可量化**：选项必须给出可观测的具体值（如"16px""8px""12px"），不要"现代化/美观"等空话
4. **不超过 5 个选项**：默认 3-4 个，每个选项关联一个 target_tag（格式 "维度:值"）
5. **简短**：question_text 控制在 1 行（≤30 字），why 控制在 1 句话

输出格式（严格 JSON，不要 markdown 代码块）：
{
  "question_text": "追问问题文本",
  "why": "为什么问这个（1 句话）",
  "options": [
    { "label": "选项1", "target_tag": "维度:值" }
  ],
  "allow_custom": true,
  "placeholder": "自定义输入提示"
}

维度参考（target_tag 必须用这些维度前缀）：
间距 / 圆角 / 字号 / 配色 / 对齐 / 动效 / 布局 / 层级 / 对比度 / 一致性 / 响应式 / 主题 / 影响 / 验证标准

规则：
- options 至少 2 个，最多 5 个
- allow_custom 默认 true
- 不要重复问用户已经在历史 QA 中明确回答过的内容
- 如果当前阶段是 perceive，追问应聚焦"场景澄清"；spec 阶段聚焦"数值规格"；verify 阶段聚焦"验收标准"`;
}

/** 用户提示词：拼装上下文给 LLM */
export function buildUserPrompt(input: FollowupPromptInput): string {
  const lines: string[] = [];
  lines.push(`用户种子描述：${input.seed}`);

  if (input.currentStage) {
    lines.push(`当前阶段：${input.currentStage}`);
  }

  if (input.currentQuestionText) {
    lines.push(`刚才用户回答的题：${input.currentQuestionText}`);
  }

  if (input.userAnswer) {
    lines.push(`用户的回答：${input.userAnswer}`);
  }

  // 触发原因翻译成 LLM 能理解的提示
  const triggerHint: Record<FollowupTrigger, string> = {
    'high-ambiguity': '触发原因：用户最初描述歧义度高（多种理解可能），需要澄清',
    'consecutive-custom': '触发原因：用户连续多次选择"自定义输入"而非选项，说明已有选项未覆盖其需求，需要追问真实诉求',
    'stage-transition-with-skip': '触发原因：用户即将进入下一阶段但本阶段有跳过的题，需要补全关键信息',
  };
  lines.push(triggerHint[input.trigger]);

  if (input.suggestedFollowup) {
    lines.push(`（参考）之前意图分析建议的追问：${input.suggestedFollowup}`);
  }
  if (input.followupOptions && input.followupOptions.length > 0) {
    lines.push(`（参考）建议选项：${input.followupOptions.join(' / ')}`);
  }

  if (input.recentQA && input.recentQA.length > 0) {
    lines.push('');
    lines.push('历史问答（最近 5 条，请避免重复）：');
    for (const qa of input.recentQA.slice(-5)) {
      lines.push(`Q: ${qa.question}`);
      lines.push(`A: ${qa.answer}`);
    }
  }

  lines.push('');
  lines.push('请基于上述上下文生成一道精准的追问题。');
  return lines.join('\n');
}

/** 构建完整的 LLM 请求消息 */
export function buildFollowupMessages(input: FollowupPromptInput): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(input) },
  ];
}
