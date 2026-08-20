// src/engine/__tests__/targetToolProfiles.test.ts
// Task 6 + Task 7：目标工具 profile 常量与 PromptGenerator 结构适配测试
import { describe, it, expect } from 'vitest';
import { PromptGenerator } from '../PromptGenerator';
import { TARGET_TOOL_PROFILES, TARGET_TOOL_OPTIONS } from '../targetToolProfiles';
import type { IntentTag } from '@/types/intent-tag';
import type { Answer } from '@/types/state';
import type { ProjectFingerprint } from '@/types/project';

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

function makeBaseInput() {
  return {
    intentTags: [
      makeTag({ id: 't1', label: '场景', value: '修UI', stage: 'perceive' }),
      makeTag({ id: 't2', label: '布局', value: '紧凑', stage: 'spec' }),
    ],
    answers: { 'p-001': makeAnswer({ raw: '卡片太挤' }) },
    seedInput: '修卡片',
  };
}

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
  conventions: ['使用 TypeScript'],
  detected_features: ['TypeScript'],
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
    src_layout: ['components', 'engine'],
    root_layout: ['src'],
  },
};

// ─── Task 6：profile 常量 ────────────────────────────────────

describe('targetToolProfiles 常量', () => {
  it('包含 5 个工具 profile，结构差异字段正确', () => {
    expect(Object.keys(TARGET_TOOL_PROFILES)).toHaveLength(5);
    expect(TARGET_TOOL_PROFILES.generic).toMatchObject({
      id: 'generic',
      label: '通用',
    });
    expect(TARGET_TOOL_PROFILES.generic.useXmlTags).toBeUndefined();
    expect(TARGET_TOOL_PROFILES.generic.useStructuredSpec).toBeUndefined();
    expect(TARGET_TOOL_PROFILES['claude-code'].useXmlTags).toBe(true);
    expect(TARGET_TOOL_PROFILES.cursor).toMatchObject({
      includeFilePathHints: true,
      includeTaskBreakdown: true,
      includeStopConditions: true,
    });
    expect(TARGET_TOOL_PROFILES.copilot.includeTaskBreakdown).toBe(true);
    expect(TARGET_TOOL_PROFILES.copilot.includeStopConditions).toBeUndefined();
    expect(TARGET_TOOL_PROFILES.codex.useStructuredSpec).toBe(true);
  });

  it('每个 profile 均有中文 label 与一句话 description', () => {
    for (const profile of Object.values(TARGET_TOOL_PROFILES)) {
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.description.length).toBeGreaterThan(0);
    }
  });

  it('TARGET_TOOL_OPTIONS 供 UI 渲染，与 profile 一一对应', () => {
    expect(TARGET_TOOL_OPTIONS).toHaveLength(5);
    expect(TARGET_TOOL_OPTIONS.map((o) => o.value)).toEqual([
      'generic',
      'claude-code',
      'cursor',
      'copilot',
      'codex',
    ]);
    expect(TARGET_TOOL_OPTIONS.map((o) => o.label)).toEqual([
      '通用',
      'Claude Code',
      'Cursor',
      'GitHub Copilot',
      'Codex',
    ]);
    for (const o of TARGET_TOOL_OPTIONS) {
      expect(o.description.length).toBeGreaterThan(0);
    }
  });
});

// ─── Task 7：PromptGenerator 结构适配 ────────────────────────

describe('PromptGenerator 目标工具适配', () => {
  it('generic（默认）：不写入 target_tool，输出不含任何新结构（基线回归）', () => {
    const gen = new PromptGenerator();
    const result = gen.generate(makeBaseInput());
    expect(result.target_tool).toBeUndefined();
    const md = gen.toMarkdown(result);
    expect(md).toContain('## 1. 要做什么');
    expect(md).toContain('## 4. 怎么算做好了');
    expect(md).not.toContain('<task>');
    expect(md).not.toContain('</constraints>');
    expect(md).not.toContain('## 相关文件');
    expect(md).not.toContain('## 执行步骤');
    expect(md).not.toContain('## 停止条件');
    expect(md).not.toContain('## 验收标准');
  });

  it('显式 targetTool: generic 与不传输出完全一致', () => {
    const gen = new PromptGenerator();
    const r1 = gen.generate(makeBaseInput());
    const r2 = gen.generate({ ...makeBaseInput(), targetTool: 'generic' });
    expect(r2.target_tool).toBeUndefined();
    // 对齐时间戳后全文比对
    r2.generated_at = r1.generated_at;
    expect(gen.toMarkdown(r2)).toBe(gen.toMarkdown(r1));
  });

  it('claude-code：主要分段用 XML 标签包裹，原有标题与内容保留', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({ ...makeBaseInput(), targetTool: 'claude-code' });
    expect(result.target_tool).toBe('claude-code');
    const md = gen.toMarkdown(result);
    expect(md).toContain('<task>');
    expect(md).toContain('</task>');
    expect(md).toContain('<spec>');
    expect(md).toContain('<constraints>');
    expect(md).toContain('<acceptance_criteria>');
    // 原有分段标题与内容不丢
    expect(md).toContain('## 1. 要做什么');
    expect(md).toContain('## 2. 怎么做');
    expect(md).toContain('## 3. 不能怎么');
    expect(md).toContain('## 4. 怎么算做好了');
    expect(md).toContain('将目标 UI 元素按以下规格调整');
    expect(md).toContain('布局: 紧凑');
    // 无项目上下文时不出现 <context>
    expect(md).not.toContain('<context>');
    // XML 包裹应在尾部元数据（意图标签清单）之前闭合
    expect(md.indexOf('</acceptance_criteria>')).toBeLessThan(md.indexOf('**意图标签清单'));
    expect(md.indexOf('</acceptance_criteria>')).toBeGreaterThan(-1);
  });

  it('claude-code（含项目上下文）：项目上下文段用 <context> 包裹', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({ ...makeBaseInput(), targetTool: 'claude-code', project: MOCK_PROJECT });
    const md = gen.toMarkdown(result);
    expect(md).toContain('<context>');
    expect(md).toContain('</context>');
    expect(md).toContain('当前项目：test-app');
    expect(md).toContain('<task>');
  });

  it('cursor：含相关文件占位段、执行步骤（spec/verify 拆行）与停止条件', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({ ...makeBaseInput(), targetTool: 'cursor' });
    expect(result.target_tool).toBe('cursor');
    const md = gen.toMarkdown(result);
    expect(md).toContain('## 相关文件');
    expect(md).toContain('（在此列出相关文件路径，如 src/components/Foo.tsx）');
    expect(md).toContain('## 执行步骤');
    expect(md).toMatch(/^1\. /m);
    // 步骤来自 spec / verify 已有内容，不新造
    expect(md).toContain('布局: 紧凑');
    expect(md).toContain('改动后截图');
    expect(md).toContain('## 停止条件');
    expect(md).toContain('完成上述步骤并通过验证后停止');
    // 相关文件段在第一个主要分段之前
    expect(md.indexOf('## 相关文件')).toBeLessThan(md.indexOf('## 1. 要做什么'));
  });

  it('copilot：结尾含简洁执行步骤，不含相关文件/停止条件', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({ ...makeBaseInput(), targetTool: 'copilot' });
    expect(result.target_tool).toBe('copilot');
    const md = gen.toMarkdown(result);
    expect(md).toContain('## 执行步骤');
    expect(md).toMatch(/^1\. /m);
    expect(md).not.toContain('## 相关文件');
    expect(md).not.toContain('## 停止条件');
  });

  it('codex：输出规格化段落（目标/输出/约束/验收标准），映射现有 segment 不丢内容', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({ ...makeBaseInput(), targetTool: 'codex' });
    expect(result.target_tool).toBe('codex');
    const md = gen.toMarkdown(result);
    expect(md).toContain('## 目标');
    expect(md).toContain('## 输出');
    expect(md).toContain('## 约束');
    expect(md).toContain('## 验收标准');
    // 原四段标题被替换
    expect(md).not.toContain('## 1. 要做什么');
    expect(md).not.toContain('## 4. 怎么算做好了');
    // 内容不丢：action / spec / constraint / verify 均映射
    expect(md).toContain('将目标 UI 元素按以下规格调整');
    expect(md).toContain('布局: 紧凑');
    expect(md).toContain('不得引入新的 npm 依赖');
    expect(md).toContain('改动后截图');
    // 无项目上下文时无「## 输入」段
    expect(md).not.toContain('## 输入');
  });

  it('codex（含项目上下文）：项目上下文映射到「## 输入」', () => {
    const gen = new PromptGenerator();
    const result = gen.generate({ ...makeBaseInput(), targetTool: 'codex', project: MOCK_PROJECT });
    const md = gen.toMarkdown(result);
    expect(md).toContain('## 输入');
    expect(md).toContain('当前项目：test-app');
  });

  it('regenerate 可透传 targetTool', () => {
    const gen = new PromptGenerator();
    const tags = [makeTag({ id: 't1', label: '场景', value: '修UI', stage: 'perceive' })];
    const result = gen.regenerate(tags, {}, '修 UI', undefined, { targetTool: 'claude-code' });
    expect(result.target_tool).toBe('claude-code');
    expect(gen.toMarkdown(result)).toContain('<task>');
  });
});
