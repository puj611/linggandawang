// src/engine/prompts/intent-analysis.ts
// LLM 意图分析 prompt 模板
// 将用户模糊描述转化为结构化意图分析，替代 seedRouter 的 string.includes 匹配

import type { ChatMessage } from '@/lib/llm/types';

/**
 * 构建意图分析的系统 prompt
 * 角色：灵感大王的意图分析引擎，将用户的模糊描述结构化
 */
export function buildSystemPrompt(projectStack?: string): string {
  const stackLine = projectStack ? `\n用户项目技术栈：${projectStack}` : '';
  return `你是「灵感大王」的意图分析引擎。你的任务是将用户的模糊描述转化为结构化的意图分析。

分析维度：
1. 场景判定：
   - frontend-ui（前端界面：页面/按钮/配色/间距/圆角等 UI 调整）
   - backend-api（后端接口：API/数据库/认证/分页等）
   - ppt（PPT/演示文稿/幻灯片场景）
   - fullstack（前后端全栈，同时涉及 UI 和 API）
2. 痛点提取：用户提到的具体问题
3. 维度识别：
   - frontend-ui 场景：映射到设计维度（间距/圆角/字号/配色/对齐/动效/布局/层级/对比度/一致性）
   - backend-api 场景：映射到后端维度（接口风格/数据模型/认证/分页/错误码/技术栈等）
   - ppt 场景：映射到演示维度（受众/篇幅/风格/视觉效果/输出格式等），不要套用 UI 维度
4. 紧急度：low（优化型）/ medium（改进型）/ high（阻断型）
5. 歧义度：0-1，>0.6 表示用户描述存在多种理解可能，需要追问澄清
6. 追问建议：当歧义度高时，建议一个澄清问题（不超过 2 行，含 3-4 个选项）${stackLine}

输出格式（严格 JSON，不要 markdown 代码块）：
{
  "scene": "frontend-ui | backend-api | ppt | fullstack",
  "pain_points": [
    { "text": "具体痛点描述", "dimension": "维度名称", "severity": 1-5 }
  ],
  "detected_dimensions": [
    { "tag": "维度标签（如 间距:太挤 或 输出格式:pptx）", "weight": 0.0-1.0, "confidence": 0.0-1.0 }
  ],
  "urgency": "low | medium | high",
  "ambiguity_score": 0.0-1.0,
  "suggested_followup": "追问问题文本 或 null",
  "followup_options": ["选项1", "选项2", "选项3"] 
}

规则：
- pain_points 最多 5 个，按 severity 降序
- detected_dimensions 最多 8 个，weight 总和归一化到 1.0
- 如果用户描述足够清晰，ambiguity_score < 0.3，suggested_followup = null
- tag 格式为 "维度:具体值"（如 "间距:太挤"、"配色:对比度不足"、"输出格式:pptx"）
- severity 1=轻微不适、3=明显问题、5=严重阻断
- 重要：PPT/幻灯片/演示文稿/keynote 等演示任务必须判定为 ppt，不要误判为 frontend-ui
- ppt 场景下 detected_dimensions 使用演示维度，不要套用 UI 维度（间距/圆角等）`;
}

/**
 * 构建意图分析的用户 prompt
 */
export function buildUserPrompt(
  seed: string,
  recentQA?: Array<{ question: string; answer: string }>,
): string {
  let prompt = `用户输入：${seed}`;
  if (recentQA && recentQA.length > 0) {
    prompt += '\n\n历史问答（最近 5 条）：';
    for (const qa of recentQA.slice(-5)) {
      prompt += `\nQ: ${qa.question}\nA: ${qa.answer}`;
    }
  }
  return prompt;
}

/**
 * 构建完整的 LLM 请求消息
 */
export function buildIntentAnalysisMessages(
  seed: string,
  projectStack?: string,
  recentQA?: Array<{ question: string; answer: string }>,
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(projectStack) },
    { role: 'user', content: buildUserPrompt(seed, recentQA) },
  ];
}
