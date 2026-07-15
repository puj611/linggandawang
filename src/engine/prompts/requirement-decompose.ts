// src/engine/prompts/requirement-decompose.ts
// LLM 需求拆解 prompt 模板
// 将用户的自然语言需求描述拆解为结构化子任务清单

import type { ChatMessage } from '@/lib/llm/types';
import type { ProjectFingerprint } from '@/types/project';

/**
 * 构建需求拆解的系统 prompt
 */
export function buildDecomposeSystemPrompt(project?: ProjectFingerprint | null): string {
  const stackInfo = project
    ? `\n项目技术栈：${[project.framework, project.language, project.css_solution].filter(Boolean).join(' / ')}`
    : '';

  return `你是「灵感大王」的需求拆解引擎。你的任务是将用户的需求描述拆解为可执行的子任务清单。

输出格式（严格 JSON，不要 markdown 代码块）：
{
  "title": "需求标题（简短）",
  "summary": "需求概述（1-2 句话）",
  "subtasks": [
    {
      "title": "子任务标题（动词开头，如'实现XXX''修复XXX''添加XXX'）",
      "description": "详细描述（包含验收标准）",
      "type": "feature | bugfix | refactor | test | docs | design",
      "priority": "P0 | P1 | P2",
      "estimated_hours": 0.5,
      "dependencies": [],
      "affected_files": ["src/components/XXX.tsx"],
      "prompt_suggestion": "给 PromptGenerator 的建议：这段子任务应该生成什么样的提示词结构"
    }
  ]
}

规则：
1. 子任务按优先级排序（P0 > P1 > P2），同优先级按依赖关系排序
2. 每个子任务的 estimated_hours 应合理（0.25h ~ 8h）
3. dependencies 是子任务数组的索引（0-based），表示前置依赖
4. affected_files 尽量精确到具体文件路径
5. prompt_suggestion 用于指导后续提示词生成，应包含：
   - 该子任务需要的提示词段落（动作段/规格段/约束段/验证段）
   - 关键技术约束
   - 验收标准要点
6. 子任务数量控制在 3-10 个，避免过于碎片化
7. feature 类型必须有验收标准
8. bugfix 类型必须描述复现步骤和期望行为
9. 涉及项目技术栈时，优先使用项目已有的库和模式${stackInfo}`;
}

/**
 * 构建需求拆解的用户 prompt
 */
export function buildDecomposeUserPrompt(
  description: string,
  project?: ProjectFingerprint | null,
  intentTags?: Array<{ label: string; value: string }>,
): string {
  let prompt = `用户需求：${description}`;

  if (intentTags && intentTags.length > 0) {
    prompt += '\n\n已识别的意图标签：';
    for (const tag of intentTags) {
      prompt += `\n- ${tag.label}: ${tag.value}`;
    }
  }

  if (project) {
    prompt += `\n\n项目信息：`;
    prompt += `\n- 名称：${project.name}`;
    prompt += `\n- 技术栈：${[project.framework, project.language, project.css_solution].filter(Boolean).join(' + ')}`;
    if (project.structure.has_components) prompt += '\n- 有 components 目录';
    if (project.structure.has_hooks) prompt += '\n- 有 hooks 目录';
    if (project.structure.has_stores) prompt += '\n- 有 stores 目录';
    if (project.structure.has_types) prompt += '\n- 有 types 目录';
    if (project.structure.has_lib) prompt += '\n- 有 lib 目录';
  }

  return prompt;
}

/**
 * 构建完整的 LLM 请求消息
 */
export function buildDecomposeMessages(
  description: string,
  project?: ProjectFingerprint | null,
  intentTags?: Array<{ label: string; value: string }>,
): ChatMessage[] {
  return [
    { role: 'system', content: buildDecomposeSystemPrompt(project) },
    { role: 'user', content: buildDecomposeUserPrompt(description, project, intentTags) },
  ];
}
