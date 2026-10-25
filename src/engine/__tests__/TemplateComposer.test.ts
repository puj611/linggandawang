// src/engine/__tests__/TemplateComposer.test.ts
// R05 变量模板组合器单测：占位符解析/去重、类型推断、缺参禁止生成、填充生成
import { describe, it, expect } from 'vitest';
import {
  parseTemplateVariables,
  inferVariableType,
  composePrompt,
  buildUserTemplate,
} from '../TemplateComposer';

describe('parseTemplateVariables', () => {
  it('解析全部占位符并按出现顺序去重', () => {
    const body = '把{{target}}的{{间距}}改为{{间距}}，{{颜色}}用蓝色，作用于{{target}}';
    expect(parseTemplateVariables(body)).toEqual(['target', '间距', '颜色']);
  });

  it('容忍变量名两侧空格，空名忽略', () => {
    expect(parseTemplateVariables('{{ name }} 和 {{  }} 和 {{}}')).toEqual(['name']);
  });

  it('无占位符返回空数组；不匹配单花括号', () => {
    expect(parseTemplateVariables('纯文本 {target} { {x} }')).toEqual([]);
  });

  it('嵌套花括号取内层名为变量（正则从第二个 { 开始匹配）', () => {
    // {{{a}}} → 匹配到内层 {{a}}，提取 "a"；外层花括号成为字面文本的一部分
    expect(parseTemplateVariables('{{{a}}}')).toEqual(['a']);
  });
});

describe('inferVariableType', () => {
  it('数字类变量名推断 number', () => {
    for (const name of ['间距', '数量', '宽度', '字号', 'px', 'size', 'count']) {
      expect(inferVariableType(name)).toBe('number');
    }
  });

  it('其余推断 text', () => {
    for (const name of ['target', '颜色', '风格', '文案']) {
      expect(inferVariableType(name)).toBe('text');
    }
  });
});

describe('composePrompt', () => {
  const body = '把{{target}}的间距改为{{间距}}px';

  it('全部填写：替换全部占位符生成完整文本', () => {
    const r = composePrompt(body, { target: '登录按钮', 间距: '12' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('把登录按钮的间距改为12px');
    expect(r.missing).toEqual([]);
  });

  it('缺参：ok=false，missing 按模板顺序列出，不产出文本（缺参禁止生成）', () => {
    const r = composePrompt(body, { target: '登录按钮' });
    expect(r.ok).toBe(false);
    expect(r.text).toBe('');
    expect(r.missing).toEqual(['间距']);
  });

  it('空白值视为缺失', () => {
    const r = composePrompt(body, { target: '登录按钮', 间距: '   ' });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['间距']);
  });

  it('值可包含 {{ }} 字面量但不二次展开', () => {
    const r = composePrompt('{{a}}', { a: '{{b}}' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{{b}}');
  });

  it('重复占位符全部替换', () => {
    const r = composePrompt('{{x}}-{{x}}', { x: 'A' });
    expect(r.text).toBe('A-A');
  });
});

describe('buildUserTemplate', () => {
  it('名称兜底、标签去重去空白、变量快照', () => {
    const tpl = buildUserTemplate({
      name: '  ',
      body: '{{target}} 用 {{颜色}}',
      tags: ['UI', ' UI ', '', '后端'],
    });
    expect(tpl.name).toBe('未命名模板');
    expect(tpl.tags).toEqual(['UI', '后端']);
    expect(tpl.vars).toEqual(['target', '颜色']);
  });
});
