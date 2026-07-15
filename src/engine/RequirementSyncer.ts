// src/engine/RequirementSyncer.ts
// 需求同步器核心引擎
// 将自然语言需求拆解为结构化子任务，支持进度跟踪和提示词聚焦

import { v4 as uuidv4 } from 'uuid';
import { getAdapter } from '@/lib/llm';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useLLMAvailabilityStore } from '@/stores/llmAvailabilityStore';
import { buildDecomposeMessages } from './prompts/requirement-decompose';
import type {
  Requirement,
  Subtask,
  SubtaskStatus,
  SubtaskPriority,
  SubtaskType,
  RequirementDecomposition,
} from '@/types/requirement';
import type { ProjectFingerprint } from '@/types/project';
import type { IntentTag } from '@/types/intent-tag';
import type { PromptResult, PromptSegment } from '@/types/prompt';

const DECOMPOSE_TIMEOUT_MS = 15000;

/** 需求拆解结果 */
export interface DecomposeResult {
  requirement: Requirement;
  warnings: string[];
}

/**
 * 需求同步器核心类
 */
export class RequirementSyncer {
  /**
   * 将自然语言需求拆解为结构化子任务
   */
  async decompose(
    description: string,
    project?: ProjectFingerprint | null,
    intentTags?: IntentTag[],
  ): Promise<DecomposeResult | null> {
    const { config, hasApiKey } = useApiKeyStore.getState();
    if (!config || !hasApiKey) {
      return this.decomposeLocal(description, project, intentTags);
    }

    if (!useLLMAvailabilityStore.getState().shouldAttempt()) {
      console.info('[RequirementSyncer] LLM 熔断中，降级到本地拆解');
      return this.decomposeLocal(description, project, intentTags);
    }

    const apiKey = await useApiKeyStore.getState().getApiKey();
    if (!apiKey) return this.decomposeLocal(description, project, intentTags);

    const adapter = getAdapter(config.provider);
    const mappedTags = intentTags?.map((t) => ({ label: t.label, value: t.value }));
    const messages = buildDecomposeMessages(description, project, mappedTags);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DECOMPOSE_TIMEOUT_MS);

      const response = await adapter.chat(
        {
          messages,
          model: config.model,
          temperature: 0.3,
          max_tokens: 2000,
        },
        apiKey,
        config.baseUrl,
        controller.signal,
      );

      clearTimeout(timeout);

      const decomposition = parseDecompositionResponse(response.content);
      if (!decomposition) {
        console.warn('[RequirementSyncer] LLM 输出解析失败，降级到本地拆解');
        return this.decomposeLocal(description, project, intentTags);
      }

      useLLMAvailabilityStore.getState().recordSuccess();
      const requirement = this.buildRequirement(decomposition, description, project, intentTags);
      return { requirement, warnings: [] };
    } catch (e) {
      console.warn('[RequirementSyncer] LLM 拆解失败，降级到本地拆解', e);
      useLLMAvailabilityStore.getState().recordFailure(e);
      return this.decomposeLocal(description, project, intentTags);
    }
  }

  /**
   * 本地规则拆解（LLM 不可用时的降级方案）
   */
  private decomposeLocal(
    description: string,
    project?: ProjectFingerprint | null,
    intentTags?: IntentTag[],
  ): DecomposeResult | null {
    const warnings: string[] = ['LLM 不可用，使用本地规则拆解（精度有限）'];

    const decomposition = this.localDecompose(description);
    const requirement = this.buildRequirement(decomposition, description, project, intentTags);
    return { requirement, warnings };
  }

  /**
   * 基于规则的本地需求拆解
   */
  private localDecompose(description: string): RequirementDecomposition {
    const subtasks: RequirementDecomposition['subtasks'] = [];

    // 关键词匹配拆解规则
    const rules: Array<{
      pattern: RegExp;
      type: SubtaskType;
      priority: SubtaskPriority;
      template: (match: RegExpMatchArray) => { title: string; description: string; suggestion: string };
    }> = [
      {
        pattern: /(?:修复|fix|修|改bug|解决)\s*(.+)/i,
        type: 'bugfix',
        priority: 'P0',
        template: (m) => ({
          title: `修复 ${m[1].trim()}`,
          description: `修复问题：${m[1].trim()}\n复现步骤：待补充\n期望行为：修复后应正常工作`,
          suggestion: 'bugfix 类型：动作段描述修复目标，规格段描述期望行为，验证段列出回归测试要点',
        }),
      },
      {
        pattern: /(?:添加|增加|新增|新增加|add|implement)\s*(.+)/i,
        type: 'feature',
        priority: 'P1',
        template: (m) => ({
          title: `实现 ${m[1].trim()}`,
          description: `实现功能：${m[1].trim()}\n验收标准：功能可正常使用`,
          suggestion: 'feature 类型：动作段描述功能目标，规格段列出技术规格，约束段说明边界，验证段定义验收标准',
        }),
      },
      {
        pattern: /(?:优化|改进|提升|enhance|improve)\s*(.+)/i,
        type: 'refactor',
        priority: 'P2',
        template: (m) => ({
          title: `优化 ${m[1].trim()}`,
          description: `优化目标：${m[1].trim()}\n预期效果：性能/体验提升`,
          suggestion: 'refactor 类型：动作段描述优化目标，规格段列出量化指标，验证段对比优化前后',
        }),
      },
      {
        pattern: /(?:测试|test)\s*(.+)/i,
        type: 'test',
        priority: 'P1',
        template: (m) => ({
          title: `编写 ${m[1].trim()} 测试`,
          description: `为 ${m[1].trim()} 编写单元测试`,
          suggestion: 'test 类型：动作段描述测试目标，规格段列出测试场景，验证段确认覆盖率',
        }),
      },
      {
        pattern: /(?:文档|doc|说明)\s*(.+)/i,
        type: 'docs',
        priority: 'P2',
        template: (m) => ({
          title: `编写 ${m[1].trim()} 文档`,
          description: `为 ${m[1].trim()} 编写文档`,
          suggestion: 'docs 类型：动作段描述文档范围，规格段列出文档结构，验证段确认完整性',
        }),
      },
      {
        pattern: /(?:设计|UI|界面|界面设计|design)\s*(.+)/i,
        type: 'design',
        priority: 'P1',
        template: (m) => ({
          title: `设计 ${m[1].trim()}`,
          description: `设计 ${m[1].trim()}`,
          suggestion: 'design 类型：动作段描述设计目标，规格段列出视觉规格，验证段对照设计稿验收',
        }),
      },
    ];

    // 按标点分割多条需求
    const parts = description.split(/[；;。.!！\n]+/).filter((s) => s.trim().length > 0);

    for (const part of parts) {
      let matched = false;
      for (const rule of rules) {
        const match = part.match(rule.pattern);
        if (match) {
          const { title, description: desc, suggestion } = rule.template(match);
          subtasks.push({
            title,
            description: desc,
            type: rule.type,
            priority: rule.priority,
            estimated_hours: rule.type === 'bugfix' ? 1 : rule.type === 'feature' ? 2 : 1.5,
            dependencies: [],
            affected_files: [],
            prompt_suggestion: suggestion,
          });
          matched = true;
          break;
        }
      }
      if (!matched && part.trim().length > 2) {
        subtasks.push({
          title: `处理：${part.trim().slice(0, 50)}`,
          description: part.trim(),
          type: 'feature',
          priority: 'P1',
          estimated_hours: 2,
          dependencies: [],
          affected_files: [],
          prompt_suggestion: '通用类型：动作段描述需求，规格段列出技术规格，约束段说明约束，验证段定义验收标准',
        });
      }
    }

    if (subtasks.length === 0) {
      subtasks.push({
        title: `实现需求：${description.slice(0, 50)}`,
        description: description,
        type: 'feature',
        priority: 'P1',
        estimated_hours: 2,
        dependencies: [],
        affected_files: [],
        prompt_suggestion: '通用类型：动作段描述需求，规格段列出技术规格，约束段说明约束，验证段定义验收标准',
      });
    }

    return {
      title: description.slice(0, 50),
      summary: description,
      subtasks,
    };
  }

  /**
   * 从 LLM 拆解结果构建 Requirement 对象
   */
  private buildRequirement(
    decomposition: RequirementDecomposition,
    rawInput: string,
    project?: ProjectFingerprint | null,
    intentTags?: IntentTag[],
  ): Requirement {
    const now = new Date().toISOString();
    const subtasks: Subtask[] = decomposition.subtasks.map((st) => ({
      id: `st-${uuidv4().slice(0, 8)}`,
      title: st.title,
      description: st.description,
      type: st.type,
      status: 'pending' as SubtaskStatus,
      priority: st.priority,
      estimated_hours: st.estimated_hours,
      actual_hours: 0,
      dependencies: st.dependencies.map((depIdx) => `st-placeholder-${depIdx}`),
      affected_files: st.affected_files,
      related_tags: [],
      prompt_suggestion: st.prompt_suggestion,
      created_at: now,
      updated_at: now,
    }));

    // 修复依赖 ID（从索引映射到实际 ID）
    for (let i = 0; i < decomposition.subtasks.length; i++) {
      const st = decomposition.subtasks[i];
      subtasks[i].dependencies = st.dependencies
        .filter((depIdx) => depIdx >= 0 && depIdx < subtasks.length)
        .map((depIdx) => subtasks[depIdx].id);
    }

    // 关联意图标签
    if (intentTags) {
      const tags = intentTags.map((t) => ({ label: t.label, value: t.value }));
      for (const st of subtasks) {
        st.related_tags = tags.map((t) => `${t.label}:${t.value}`);
      }
    }

    return {
      id: `req-${uuidv4().slice(0, 8)}`,
      title: decomposition.title,
      description: decomposition.summary,
      raw_input: rawInput,
      subtasks,
      status: 'ready',
      created_at: now,
      updated_at: now,
      project_path: project?.name,
      intent_tags: intentTags?.map((t) => ({ label: t.label, value: t.value })) ?? [],
    };
  }

  /**
   * 更新子任务状态
   */
  updateSubtaskStatus(
    requirement: Requirement,
    subtaskId: string,
    status: SubtaskStatus,
  ): Requirement {
    const now = new Date().toISOString();
    const subtasks = requirement.subtasks.map((st) => {
      if (st.id === subtaskId) {
        return {
          ...st,
          status,
          updated_at: now,
          completed_at: status === 'done' ? now : undefined,
        };
      }
      return st;
    });

    // 自动推进阻塞任务：如果某个任务的依赖全部完成，自动改为 pending
    const updatedSubtasks = subtasks.map((st) => {
      if (st.status === 'blocked' || st.status === 'pending') {
        const allDepsDone = st.dependencies.every((depId) => {
          const dep = subtasks.find((s) => s.id === depId);
          return dep?.status === 'done' || dep?.status === 'skipped';
        });
        if (allDepsDone && st.status === 'blocked') {
          return { ...st, status: 'pending' as SubtaskStatus, updated_at: now };
        }
      }
      return st;
    });

    // 判断整体状态
    const allDone = updatedSubtasks.every(
      (st) => st.status === 'done' || st.status === 'skipped',
    );
    const hasInProgress = updatedSubtasks.some((st) => st.status === 'in_progress');

    return {
      ...requirement,
      subtasks: updatedSubtasks,
      status: allDone ? 'completed' : hasInProgress ? 'in_progress' : 'ready',
      updated_at: now,
    };
  }

  /**
   * 获取下一个应执行的子任务（优先级最高 + 依赖已满足）
   */
  getNextSubtask(requirement: Requirement): Subtask | null {
    const priorityOrder: Record<SubtaskPriority, number> = { P0: 0, P1: 1, P2: 2 };

    const candidates = requirement.subtasks.filter((st) => {
      if (st.status !== 'pending') return false;
      // 检查依赖是否全部完成
      return st.dependencies.every((depId) => {
        const dep = requirement.subtasks.find((s) => s.id === depId);
        return dep?.status === 'done' || dep?.status === 'skipped';
      });
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const pa = priorityOrder[a.priority];
      const pb = priorityOrder[b.priority];
      if (pa !== pb) return pa - pb;
      return a.estimated_hours - b.estimated_hours;
    });

    return candidates[0];
  }

  /**
   * 基于当前子任务生成聚焦提示词
   */
  generateFocusedPrompt(
    requirement: Requirement,
    subtask: Subtask,
    project?: ProjectFingerprint | null,
  ): Partial<PromptResult> {
    const action: PromptSegment = {
      title: '要做什么',
      content: `${subtask.title}\n\n${subtask.description}`,
      raw_quote: requirement.raw_input,
    };

    const spec: PromptSegment = {
      title: '怎么做',
      content: subtask.prompt_suggestion,
    };

    const constraint: PromptSegment = {
      title: '不能怎么',
      content: this.buildConstraintFromSubtask(subtask, project),
    };

    const verify: PromptSegment = {
      title: '怎么算做好了',
      content: this.buildVerifyFromSubtask(subtask),
    };

    return {
      action,
      spec,
      constraint,
      verify,
      intent_tags: requirement.intent_tags.map((t) => ({
        id: uuidv4(),
        label: t.label,
        value: t.value,
        stage: 'perceive' as const,
        source_question_id: '',
        source_type: 'extracted-keyword' as const,
        confidence: 0.8,
        deletable: true,
        created_at: new Date().toISOString(),
      })),
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * 获取需求完成度统计
   */
  getProgress(requirement: Requirement): {
    total: number;
    done: number;
    in_progress: number;
    pending: number;
    blocked: number;
    skipped: number;
    percentage: number;
    estimated_total_hours: number;
    actual_total_hours: number;
  } {
    const subtasks = requirement.subtasks;
    const total = subtasks.length;
    const done = subtasks.filter((st) => st.status === 'done').length;
    const in_progress = subtasks.filter((st) => st.status === 'in_progress').length;
    const pending = subtasks.filter((st) => st.status === 'pending').length;
    const blocked = subtasks.filter((st) => st.status === 'blocked').length;
    const skipped = subtasks.filter((st) => st.status === 'skipped').length;
    const effective = total - skipped;
    const percentage = effective > 0 ? Math.round((done / effective) * 100) : 0;
    const estimated_total_hours = subtasks.reduce((sum, st) => sum + st.estimated_hours, 0);
    const actual_total_hours = subtasks.reduce((sum, st) => sum + st.actual_hours, 0);

    return { total, done, in_progress, pending, blocked, skipped, percentage, estimated_total_hours, actual_total_hours };
  }

  private buildConstraintFromSubtask(subtask: Subtask, project?: ProjectFingerprint | null): string {
    const lines: string[] = [];
    if (project) {
      if (project.css_solution === 'tailwind') {
        lines.push('样式方案：使用 Tailwind CSS 原子类');
      }
      if (project.language === 'typescript') {
        lines.push('语言规范：TypeScript + React 函数组件');
      }
    }
    if (subtask.type === 'bugfix') {
      lines.push('修复时不要引入新的问题');
      lines.push('保持向后兼容');
    }
    if (subtask.type === 'refactor') {
      lines.push('重构时保持外部接口不变');
      lines.push('不要改变已有行为');
    }
    lines.push('不要使用"现代化、美观、流畅"等空话，必须给出可量化规格');
    return lines.join('\n');
  }

  private buildVerifyFromSubtask(subtask: Subtask): string {
    const lines: string[] = [];
    if (subtask.type === 'bugfix') {
      lines.push('复现步骤不再触发问题');
      lines.push('相关功能回归测试通过');
    } else if (subtask.type === 'feature') {
      lines.push('功能可正常使用（点击/输入/跳转无报错）');
      lines.push('代码可通过编译/构建（无 TypeScript 错误）');
    } else if (subtask.type === 'test') {
      lines.push('测试用例全部通过');
      lines.push('测试覆盖核心逻辑分支');
    } else {
      lines.push('改动后截图，肉眼确认符合规格');
      lines.push('代码可通过编译/构建');
    }
    return lines.join('\n');
  }
}

/** 解析 LLM 返回的拆解 JSON */
function parseDecompositionResponse(content: string): RequirementDecomposition | null {
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const raw = JSON.parse(jsonStr);
    return normalizeDecomposition(raw);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const raw = JSON.parse(match[0]);
        return normalizeDecomposition(raw);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeDecomposition(raw: unknown): RequirementDecomposition | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!r.title || !Array.isArray(r.subtasks)) return null;

  const validTypes: SubtaskType[] = ['feature', 'bugfix', 'refactor', 'test', 'docs', 'design'];
  const validPriorities: SubtaskPriority[] = ['P0', 'P1', 'P2'];

  const subtasks = (r.subtasks as unknown[])
    .slice(0, 10)
    .map((st) => {
      const s = (st ?? {}) as Record<string, unknown>;
      return {
        title: String(s.title ?? ''),
        description: String(s.description ?? ''),
        type: validTypes.includes(s.type as SubtaskType) ? (s.type as SubtaskType) : 'feature',
        priority: validPriorities.includes(s.priority as SubtaskPriority) ? (s.priority as SubtaskPriority) : 'P1',
        estimated_hours: Math.min(8, Math.max(0.25, Number(s.estimated_hours) || 1)),
        dependencies: Array.isArray(s.dependencies)
          ? (s.dependencies as unknown[]).map((d) => Number(d)).filter((d) => !isNaN(d))
          : [],
          affected_files: Array.isArray(s.affected_files)
          ? (s.affected_files as unknown[]).map((f) => String(f))
          : [],
        prompt_suggestion: String(s.prompt_suggestion ?? ''),
      };
    })
    .filter((st) => st.title.length > 0);

  if (subtasks.length === 0) return null;

  return {
    title: String(r.title),
    summary: String(r.summary ?? ''),
    subtasks,
  };
}

export const requirementSyncer = new RequirementSyncer();
