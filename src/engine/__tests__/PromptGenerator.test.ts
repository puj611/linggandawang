// src/engine/__tests__/PromptGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { PromptGenerator } from '../PromptGenerator';
import type { IntentTag } from '@/types/intent-tag';
import type { Answer } from '@/types/state';
import type { ProjectFingerprint, FullScanResult } from '@/types/project';

function makeTag(partial: Partial<IntentTag>): IntentTag {
  return {
    id: 'tag-' + Math.random(),
    label: '布局',
    value: '紧凑',
    stage: 'spec',
    source_question_id: 's-001',
    source_type: 'option',
    confidence: 1,
    deletable: true,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

function makeAnswer(partial: Partial<Answer>): Answer {
  return {
    questionId: 'p-001',
    value: 'fix-ui',
    raw: '修一个看不顺眼的 UI',
    tags: [],
    skipped: false,
    answeredAt: new Date().toISOString(),
    ...partial,
  };
}

describe('PromptGenerator 四段拼装', () => {
  it('100% 输出包含四段', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [makeTag({ label: '场景', value: '修UI', stage: 'perceive' })],
      answers: { 'p-001': makeAnswer({}) },
      seedInput: '修卡片',
    });
    expect(result.action).toBeDefined();
    expect(result.spec).toBeDefined();
    expect(result.constraint).toBeDefined();
    expect(result.verify).toBeDefined();
    expect(result.action.content.length).toBeGreaterThan(0);
  });

  it('评价类语句附带量化规格（"太挤" → 内边距 16px）', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {
        'p-001': makeAnswer({ raw: '卡片太挤' }),
      },
      seedInput: '卡片太挤',
    });
    // 规格段应包含"16px"或"20px"
    expect(result.spec.content).toMatch(/(16px|20px|内边距|间距)/);
  });

  it('用户原话保留在 raw_quotes', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {
        'p-001': makeAnswer({ raw: '原话测试' }),
      },
      seedInput: '修 UI',
    });
    expect(result.raw_quotes).toContain('修 UI');
    expect(result.raw_quotes).toContain('原话测试');
  });

  it('toMarkdown 输出四段标题 + 原话注释', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [makeTag({ label: '场景', value: '修UI' })],
      answers: { 'p-001': makeAnswer({ raw: '原话' }) },
      seedInput: '修 UI',
    });
    const md = gen.toMarkdown(result);
    expect(md).toContain('# 你的提示词');
    expect(md).toContain('## 1. 要做什么');
    expect(md).toContain('## 2. 怎么做');
    expect(md).toContain('## 3. 不能怎么');
    expect(md).toContain('## 4. 怎么算做好了');
    expect(md).toContain('<!-- 原话');
  });

  it('regenerate() 基于剩余 tags 重新拼装', () => {
    const gen = new PromptGenerator();
    const tags = [
      makeTag({ id: 't1', label: '场景', value: '修UI', stage: 'perceive' }),
      makeTag({ id: 't2', label: '布局', value: '紧凑', stage: 'spec' }),
    ];
    const r1 = gen.generate({ intentTags: tags, answers: {}, seedInput: '修 UI' });
    const r2 = gen.regenerate(tags.filter((t) => t.id !== 't2'), {}, '修 UI');
    expect(r2.intent_tags.length).toBe(1);
    expect(r2.intent_tags[0].id).toBe('t1');
    expect(r1.intent_tags.length).toBe(2);
  });

  it('意图标签 ≥ 3 时 markdown 包含标签清单', () => {
    const gen = new PromptGenerator();
    const tags = [
      makeTag({ id: 't1', label: '场景', value: '修UI', stage: 'perceive' }),
      makeTag({ id: 't2', label: '布局', value: '紧凑', stage: 'spec' }),
      makeTag({ id: 't3', label: '圆角', value: '8px', stage: 'spec' }),
    ];
    const result = gen.generate({ intentTags: tags, answers: {}, seedInput: '修 UI' });
    const md = gen.toMarkdown(result);
    expect(md).toContain('意图标签清单（3 个）');
  });
});

// ─── 项目上下文 + 深度扫描注入测试 ──────────────────────────

const MOCK_PROJECT: ProjectFingerprint = {
  name: 'test-app',
  path: '/tmp/test-app',
  project_type: 'frontend',
  scanned_at: '2026-07-24T00:00:00Z',
  framework: 'react',
  language: 'typescript',
  css_solution: 'tailwind',
  ui_libraries: ['shadcn/ui'],
  state_management: ['Zustand'],
  build_tool: 'vite',
  package_manager: 'pnpm',
  conventions: ['使用 TypeScript', '函数式组件 + Hooks'],
  detected_features: ['TypeScript', 'ESLint'],
  structure: {
    has_src: true,
    has_components: true,
    has_pages: false,
    has_hooks: true,
    has_stores: true,
    has_lib: true,
    has_tests: true,
    has_assets: false,
    has_utils: false,
    has_types: true,
    src_layout: ['components', 'engine', 'hooks', 'lib', 'stores', 'types'],
    root_layout: ['src', 'docs', 'scripts'],
  },
};

const MOCK_SCAN_RESULT: FullScanResult = {
  file_tree: {
    root: '/tmp/test-app',
    total_files: 120,
    total_dirs: 25,
    total_size: 512000,
    entries: [],
    by_extension: { tsx: 30, ts: 25, css: 10, json: 8, md: 5 },
  },
  git: {
    is_repo: true,
    branch: 'main',
    changed_files: [
      { status: 'M', path: 'src/App.tsx' },
      { status: 'A', path: 'src/components/New.tsx' },
      { status: '??', path: 'src/utils/temp.ts' },
    ],
    recent_commits: [
      { hash: 'abc1234', message: 'feat: add new component', author: 'dev', date: '2026-07-24' },
      { hash: 'def5678', message: 'fix: resolve layout issue', author: 'dev', date: '2026-07-23' },
    ],
  },
  dependencies: {
    dependencies: { react: '^18.3.1', zustand: '^4.5.0' },
    dev_dependencies: { typescript: '^5.4.0', vitest: '^1.6.0' },
    scripts: { dev: 'vite', build: 'tsc && vite build' },
    lock_file: 'pnpm-lock.yaml',
  },
  todos: [
    { file: 'src/App.tsx', line: 10, tag: 'TODO', content: 'refactor this' },
    { file: 'src/utils.ts', line: 5, tag: 'FIXME', content: 'broken edge case' },
    { file: 'src/old.ts', line: 1, tag: 'HACK', content: 'temporary workaround' },
  ],
  scan_time_ms: 350,
};

describe('PromptGenerator 项目上下文注入', () => {
  it('无 project 时 project_context 为 null', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({ intentTags: [], answers: {}, seedInput: '修 UI' });
    expect(result.project_context).toBeNull();
  });

  it('有 project 时生成项目上下文段', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
    });
    expect(result.project_context).not.toBeNull();
    expect(result.project_context!.content).toContain('test-app');
    expect(result.project_context!.content).toContain('React');
    expect(result.project_context!.content).toContain('TypeScript');
    expect(result.project_context!.content).toContain('Tailwind CSS');
    expect(result.project_context!.content).toContain('Zustand');
  });

  it('markdown 包含项目上下文段标题', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
    });
    const md = gen.toMarkdown(result);
    expect(md).toContain('## 0. 项目上下文');
    expect(md).toContain('灵感大王自动注入');
  });

  it('scanResult 注入 Git 状态', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: MOCK_SCAN_RESULT,
    });
    const ctx = result.project_context!.content;
    expect(ctx).toContain('Git 状态');
    expect(ctx).toContain('当前分支：main');
    expect(ctx).toContain('App.tsx(M)');
    expect(ctx).toContain('New.tsx(A)');
    expect(ctx).toContain('abc1234');
    expect(ctx).toContain('feat: add new component');
  });

  it('scanResult 注入文件统计', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: MOCK_SCAN_RESULT,
    });
    const ctx = result.project_context!.content;
    expect(ctx).toContain('项目规模');
    expect(ctx).toContain('120 个文件');
    expect(ctx).toContain('25 个目录');
    expect(ctx).toContain('.tsx(30)');
    expect(ctx).toContain('.ts(25)');
  });

  it('scanResult 注入 TODO/FIXME 标记', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: MOCK_SCAN_RESULT,
    });
    const ctx = result.project_context!.content;
    expect(ctx).toContain('代码标记');
    expect(ctx).toContain('3 处待处理');
    expect(ctx).toContain('TODO(1)');
    expect(ctx).toContain('FIXME(1)');
    expect(ctx).toContain('HACK(1)');
  });

  it('scanResult 注入依赖概况', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: MOCK_SCAN_RESULT,
    });
    const ctx = result.project_context!.content;
    expect(ctx).toContain('依赖');
    expect(ctx).toContain('2 个生产依赖');
    expect(ctx).toContain('2 个开发依赖');
    expect(ctx).toContain('pnpm-lock.yaml');
  });

  it('无 Git 仓库时不注入 Git 状态', () => {
    const gen = new PromptGenerator();
    const noGitScan: FullScanResult = {
      ...MOCK_SCAN_RESULT,
      git: { is_repo: false, changed_files: [], recent_commits: [] },
    };
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: noGitScan,
    });
    expect(result.project_context!.content).not.toContain('Git 状态');
  });

  it('无变更文件时不显示变更列表', () => {
    const gen = new PromptGenerator();
    const cleanScan: FullScanResult = {
      ...MOCK_SCAN_RESULT,
      git: {
        is_repo: true,
        branch: 'main',
        changed_files: [],
        recent_commits: [{ hash: 'abc1234', message: 'init', author: 'dev', date: '2026-07-24' }],
      },
    };
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: cleanScan,
    });
    expect(result.project_context!.content).not.toContain('未提交变更');
    expect(result.project_context!.content).toContain('最近提交');
  });

  it('变更文件超过 5 个时显示摘要', () => {
    const gen = new PromptGenerator();
    const manyChanges: FullScanResult = {
      ...MOCK_SCAN_RESULT,
      git: {
        is_repo: true,
        branch: 'dev',
        changed_files: Array.from({ length: 8 }, (_, i) => ({ status: 'M', path: `file${i}.ts` })),
        recent_commits: [],
      },
    };
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: manyChanges,
    });
    expect(result.project_context!.content).toContain('等 8 个文件');
  });

  it('空 TODO 列表不注入标记段', () => {
    const gen = new PromptGenerator();
    const noTodoScan: FullScanResult = {
      ...MOCK_SCAN_RESULT,
      todos: [],
    };
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: noTodoScan,
    });
    expect(result.project_context!.content).not.toContain('代码标记');
  });

  it('regenerate 传递 scanResult', () => {
    const gen = new PromptGenerator();
    const tags = [makeTag({ id: 't1', label: '场景', value: '修UI', stage: 'perceive' })];
    const result = gen.regenerate(tags, {}, '修 UI', MOCK_PROJECT, {
      scanResult: MOCK_SCAN_RESULT,
    });
    expect(result.project_context!.content).toContain('Git 状态');
    expect(result.project_context!.content).toContain('120 个文件');
  });

  it('toMarkdown 包含项目绑定提示', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: MOCK_SCAN_RESULT,
    });
    const md = gen.toMarkdown(result);
    expect(md).toContain('已绑定项目');
    expect(md).toContain('test-app');
  });

  it('toMarkdown 可通过选项禁用项目上下文', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({
      intentTags: [],
      answers: {},
      seedInput: '修 UI',
      project: MOCK_PROJECT,
      scanResult: MOCK_SCAN_RESULT,
    });
    const md = gen.toMarkdown(result, { include_project_context: false });
    expect(md).not.toContain('## 0. 项目上下文');
  });
});
