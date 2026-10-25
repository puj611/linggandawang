// src/engine/__tests__/prompts.test.ts
// LLM 提示词模板构造器单测：followup / intent-analysis / requirement-decompose
// 纯字符串拼装，验证上下文注入与边界（历史截断、可选段缺省）
import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt as buildFollowupSystem,
  buildUserPrompt as buildFollowupUser,
  buildFollowupMessages,
  type FollowupPromptInput,
} from '../prompts/followup';
import {
  buildSystemPrompt as buildIntentSystem,
  buildUserPrompt as buildIntentUser,
  buildIntentAnalysisMessages,
} from '../prompts/intent-analysis';
import {
  buildDecomposeSystemPrompt,
  buildDecomposeUserPrompt,
  buildDecomposeMessages,
} from '../prompts/requirement-decompose';
import type { ProjectFingerprint } from '@/types/project';

const baseProject: ProjectFingerprint = {
  name: 'demo-app',
  path: 'D:\\demo',
  framework: 'React',
  language: 'TypeScript',
  css_solution: 'Tailwind',
  structure: {
    has_components: true,
    has_hooks: false,
    has_stores: true,
    has_types: false,
    has_lib: false,
  },
} as unknown as ProjectFingerprint;

describe('prompts/followup', () => {
  it('system prompt 声明角色与输出 JSON 格式约束', () => {
    const sys = buildFollowupSystem();
    expect(sys).toContain('动态追问引擎');
    expect(sys).toContain('question_text');
    expect(sys).toContain('target_tag');
  });

  it('user prompt 全字段拼装：种子/阶段/题目/回答/触发原因/参考/历史', () => {
    const input: FollowupPromptInput = {
      seed: '给设置页加深色模式',
      trigger: 'high-ambiguity',
      currentStage: 'perceive',
      currentQuestionText: '今天想让页面有什么变化？',
      userAnswer: '加一个开关',
      suggestedFollowup: '深色模式的范围？',
      followupOptions: ['全局', '跟随系统'],
      recentQA: [{ question: 'Q1', answer: 'A1' }],
    };
    const prompt = buildFollowupUser(input);
    expect(prompt).toContain('用户种子描述：给设置页加深色模式');
    expect(prompt).toContain('当前阶段：perceive');
    expect(prompt).toContain('刚才用户回答的题：今天想让页面有什么变化？');
    expect(prompt).toContain('用户的回答：加一个开关');
    expect(prompt).toContain('歧义度高');
    expect(prompt).toContain('（参考）之前意图分析建议的追问：深色模式的范围？');
    expect(prompt).toContain('建议选项：全局 / 跟随系统');
    expect(prompt).toContain('Q: Q1');
    expect(prompt).toContain('A: A1');
  });

  it('三种触发原因各翻译成对应提示语', () => {
    const mk = (trigger: FollowupPromptInput['trigger']) =>
      buildFollowupUser({ seed: 's', trigger });
    expect(mk('consecutive-custom')).toContain('自定义输入');
    expect(mk('stage-transition-with-skip')).toContain('跳过的题');
  });

  it('历史问答只保留最近 5 条', () => {
    const qa = Array.from({ length: 8 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const prompt = buildFollowupUser({ seed: 's', trigger: 'high-ambiguity', recentQA: qa });
    expect(prompt).toContain('Q: Q7');
    expect(prompt).not.toContain('Q: Q0');
    expect(prompt).not.toContain('Q: Q2\n');
  });

  it('buildFollowupMessages 输出 system+user 两条消息', () => {
    const msgs = buildFollowupMessages({ seed: 's', trigger: 'high-ambiguity' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect((msgs[1] as { content: string }).content).toContain('用户种子描述：s');
  });
});

describe('prompts/intent-analysis', () => {
  it('system prompt 含项目栈时注入，空时不注入', () => {
    expect(buildIntentSystem('React + Tailwind')).toContain('React + Tailwind');
    const plain = buildIntentSystem();
    expect(plain).not.toContain('React + Tailwind');
    expect(plain).toContain('ppt');
  });

  it('user prompt 拼装输入与最近 5 条历史', () => {
    const qa = Array.from({ length: 7 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
    const prompt = buildIntentUser('让按钮更显眼', qa);
    expect(prompt).toContain('用户输入：让按钮更显眼');
    expect(prompt).toContain('Q: Q6');
    expect(prompt).not.toContain('Q: Q1\n');
    expect(buildIntentUser('x')).toBe('用户输入：x');
  });

  it('buildIntentAnalysisMessages 组装两条消息', () => {
    const msgs = buildIntentAnalysisMessages('seed', 'Vite', []);
    expect(msgs).toHaveLength(2);
    expect((msgs[0] as { content: string }).content).toContain('Vite');
  });
});

describe('prompts/requirement-decompose', () => {
  it('system prompt 无项目时不含技术栈注入段，有项目时注入', () => {
    expect(buildDecomposeSystemPrompt(null)).not.toContain('项目技术栈：');
    expect(buildDecomposeSystemPrompt(baseProject)).toContain('项目技术栈：React / TypeScript / Tailwind');
  });

  it('user prompt 拼装需求/意图标签/项目结构与目录标志', () => {
    const prompt = buildDecomposeUserPrompt('加导出按钮', baseProject, [
      { label: '间距', value: '16px' },
    ]);
    expect(prompt).toContain('用户需求：加导出按钮');
    expect(prompt).toContain('- 间距: 16px');
    expect(prompt).toContain('- 名称：demo-app');
    expect(prompt).toContain('React + TypeScript + Tailwind');
    expect(prompt).toContain('有 components 目录');
    expect(prompt).toContain('有 stores 目录');
    expect(prompt).not.toContain('有 hooks 目录');
  });

  it('buildDecomposeMessages 透传参数', () => {
    const msgs = buildDecomposeMessages('需求', baseProject);
    expect(msgs).toHaveLength(2);
    expect((msgs[1] as { content: string }).content).toContain('用户需求：需求');
  });
});
