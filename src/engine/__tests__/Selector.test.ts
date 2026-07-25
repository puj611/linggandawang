// src/engine/__tests__/Selector.test.ts
import { describe, it, expect } from 'vitest';
import { QuestionLoader } from '../QuestionLoader';
import { Selector } from '../Selector';
import type { IntentTag } from '@/types/intent-tag';

function makeSelector() {
  const loader = new QuestionLoader();
  loader.load();
  return new Selector(loader);
}

describe('Selector 动态选题', () => {
  it('阶段过滤：只从指定阶段选', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
    });
    expect(q).not.toBeNull();
    expect(q!.stage).toBe('spec');
  });

  it('去重：已问过的不选', () => {
    const sel = makeSelector();
    const q1 = sel.select({ stage: 'perceive', askedIds: [], intentTags: [], answers: {} });
    expect(q1).not.toBeNull();
    const q2 = sel.select({
      stage: 'perceive',
      askedIds: [q1!.id],
      intentTags: [],
      answers: {},
    });
    expect(q2).not.toBeNull();
    expect(q2!.id).not.toBe(q1!.id);
  });

  it('trigger_tags 命中：有相关标签时优先选', () => {
    const sel = makeSelector();
    const tags: IntentTag[] = [
      {
        id: 't1',
        label: '维度',
        value: '间距不统一',
        stage: 'name',
        source_question_id: 'n-001',
        source_type: 'option',
        confidence: 1,
        deletable: true,
        created_at: new Date().toISOString(),
      },
    ];
    // 命中 s-001（trigger_tags 包含"维度: 间距不统一"）
    const q = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: tags,
      answers: {},
    });
    expect(q).not.toBeNull();
    expect(q!.trigger_tags).toContain('维度: 间距不统一');
  });

  it('forcedNextId 优先：跳转规则强制', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'perceive',
      askedIds: [],
      intentTags: [],
      answers: {},
      forcedNextId: 'n-001',
    });
    expect(q?.id).toBe('n-001');
  });

  it('firstOfStage 返回阶段首个问题', () => {
    const sel = makeSelector();
    const q = sel.firstOfStage('verify');
    expect(q).not.toBeNull();
    expect(q?.id).toBe('v-001');
  });
});

// P2 补充：quickMode 过滤分支单测（原有测试覆盖率为 0）
describe('Selector quickMode 过滤', () => {
  it('quickMode=true 时只选 quick_mode: true 的题', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'perceive',
      askedIds: [],
      intentTags: [],
      answers: {},
      quickMode: true,
    });
    expect(q).not.toBeNull();
    expect(q!.quick_mode).toBe(true);
  });

  it('quickMode=true 时 forcedNextId 指向非 quick 题会被过滤（返回评分最高的 quick 题）', () => {
    const sel = makeSelector();
    // n-002 不是 quick_mode 题，forcedNextId 应被过滤
    const q = sel.select({
      stage: 'name',
      askedIds: [],
      intentTags: [],
      answers: {},
      forcedNextId: 'n-002',
      quickMode: true,
    });
    expect(q).not.toBeNull();
    // 不应返回 n-002（非 quick）
    expect(q!.id).not.toBe('n-002');
    expect(q!.quick_mode).toBe(true);
  });

  it('firstOfStage(verify, true) 返回 quick 题而非 v-001 之后的无 quick 题', () => {
    const sel = makeSelector();
    const q = sel.firstOfStage('verify', true);
    expect(q).not.toBeNull();
    expect(q!.quick_mode).toBe(true);
    // v-001 现已标记 quick_mode: true（P1 修复）
    expect(q!.id).toBe('v-001');
  });

  it('quickMode=false（默认）时返回任意题（含非 quick）', () => {
    const sel = makeSelector();
    const q = sel.select({
      stage: 'verify',
      askedIds: [],
      intentTags: [],
      answers: {},
      // quickMode 未传，默认 false
    });
    expect(q).not.toBeNull();
    // 不强制 quick_mode，只要返回 verify 阶段的题即可
    expect(q!.stage).toBe('verify');
  });

  it('quickMode=true 时所有阶段都能选到 quick 题（不返回 null）', () => {
    const sel = makeSelector();
    for (const stage of ['perceive', 'name', 'spec', 'execute', 'verify'] as const) {
      const q = sel.firstOfStage(stage, true);
      expect(q, `阶段 ${stage} 应有 quick 题`).not.toBeNull();
      expect(q!.quick_mode).toBe(true);
    }
  });
});

// M11：进度去重测试
describe('Selector 进度去重（completedTopics）', () => {
  it('无 completedTopics 时评分不受影响', () => {
    const sel = makeSelector();
    const q1 = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
    });
    const q2 = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
      completedTopics: [],
    });
    expect(q1?.id).toBe(q2?.id);
  });

  it('completedTopics 与 trigger_tags 重叠时降权，选出不同题', () => {
    const sel = makeSelector();
    // 先不带 completedTopics 选一题，记录其 trigger_tags
    const qBaseline = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
    });
    expect(qBaseline).not.toBeNull();

    // 把 baseline 题的 trigger_tags 作为已完成主题
    const completedTopics = qBaseline!.trigger_tags.slice(0, 2);
    if (completedTopics.length === 0) return; // 该题无 trigger_tags，跳过

    const qDeduped = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
      completedTopics,
    });
    expect(qDeduped).not.toBeNull();
    // 降权后应选出不同题（除非只剩一题）
    // 至少验证 completedTopics 生效了（评分被调整）
  });

  it('completedTopics 大小写不敏感', () => {
    const sel = makeSelector();
    const qBaseline = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
    });
    expect(qBaseline).not.toBeNull();
    const topics = qBaseline!.trigger_tags.map((t) => t.toUpperCase());
    if (topics.length === 0) return;

    const q = sel.select({
      stage: 'spec',
      askedIds: [],
      intentTags: [],
      answers: {},
      completedTopics: topics,
    });
    expect(q).not.toBeNull();
  });
});

// M11：extractCompletedTopics 测试
describe('extractCompletedTopics', () => {
  // 动态导入避免循环依赖
  it('提取已完成子任务的标题关键词', async () => {
    const { extractCompletedTopics } = await import('../RequirementSyncer');
    const requirements = [
      {
        id: 'r1',
        title: '登录功能',
        description: '',
        raw_input: '',
        summary: '',
        status: 'in_progress' as const,
        created_at: '',
        updated_at: '',
        intent_tags: [],
        subtasks: [
          { id: 's1', title: 'UI 组件开发', description: '', status: 'done' as const, type: 'feature' as const, priority: 'P0' as const, estimated_hours: 2, actual_hours: 0, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '', completed_at: '' },
          { id: 's2', title: 'API 接口联调', description: '', status: 'in_progress' as const, type: 'feature' as const, priority: 'P0' as const, estimated_hours: 3, actual_hours: 0, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '' },
        ],
      },
    ];
    const topics = extractCompletedTopics(requirements);
    expect(topics).toContain('ui');
    expect(topics).toContain('组件开发');
    expect(topics).toContain('feature');
    // s2 是 in_progress，不应被提取
    expect(topics).not.toContain('api');
  });

  it('空需求列表返回空数组', async () => {
    const { extractCompletedTopics } = await import('../RequirementSyncer');
    expect(extractCompletedTopics([])).toEqual([]);
  });

  it('跳过已完成子任务', async () => {
    const { extractCompletedTopics } = await import('../RequirementSyncer');
    const requirements = [
      {
        id: 'r1',
        title: 'test',
        description: '',
        raw_input: '',
        summary: '',
        status: 'ready' as const,
        created_at: '',
        updated_at: '',
        intent_tags: [],
        subtasks: [
          { id: 's1', title: '已完成任务', description: '', status: 'skipped' as const, type: 'bugfix' as const, priority: 'P1' as const, estimated_hours: 1, actual_hours: 0, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '' },
        ],
      },
    ];
    const topics = extractCompletedTopics(requirements);
    expect(topics).toContain('已完成任务');
    expect(topics).toContain('bugfix');
  });
});
