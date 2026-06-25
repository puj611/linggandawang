// src/engine/__tests__/QuestionLoader.test.ts
import { describe, it, expect } from 'vitest';
import { QuestionLoader } from '../QuestionLoader';

describe('QuestionLoader', () => {
  it('加载内置问题库 ≥ 30 条', () => {
    const loader = new QuestionLoader();
    const bank = loader.load();
    expect(bank.schema_version).toBe('1.0');
    expect(bank.questions.length).toBeGreaterThanOrEqual(30);
  });

  it('分布：perceive 6 / name 6 / spec 8 / execute 5 / verify 5', () => {
    const loader = new QuestionLoader();
    const bank = loader.load();
    const count = (stage: string) => bank.questions.filter((q) => q.stage === stage).length;
    expect(count('perceive')).toBe(6);
    expect(count('name')).toBe(6);
    expect(count('spec')).toBe(8);
    expect(count('execute')).toBe(5);
    expect(count('verify')).toBe(5);
  });

  it('ID 唯一且符合阶段前缀', () => {
    const loader = new QuestionLoader();
    const bank = loader.load();
    const ids = bank.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of bank.questions) {
      const prefix = q.id.charAt(0);
      const expected = { perceive: 'p', name: 'n', spec: 's', execute: 'e', verify: 'v' }[q.stage];
      expect(prefix).toBe(expected);
    }
  });

  it('reload() 重新加载（异步，Tauri 环境下预加载用户 bank）', async () => {
    const loader = new QuestionLoader();
    loader.load();
    const bank2 = await loader.reload();
    expect(bank2.questions.length).toBeGreaterThanOrEqual(30);
  });

  it('至少 5 条带 jumps', () => {
    const loader = new QuestionLoader();
    const bank = loader.load();
    const withJumps = bank.questions.filter((q) => q.jumps && q.jumps.length > 0);
    expect(withJumps.length).toBeGreaterThanOrEqual(5);
  });

  it('至少 10 条带 intent_extraction', () => {
    const loader = new QuestionLoader();
    const bank = loader.load();
    const withExtraction = bank.questions.filter(
      (q) => q.intent_extraction?.keywords && q.intent_extraction.keywords.length > 0,
    );
    expect(withExtraction.length).toBeGreaterThanOrEqual(10);
  });
});
