// src/engine/__tests__/QuestionEngine.test.ts
import { describe, it, expect } from 'vitest';
import { QuestionLoader } from '../QuestionLoader';
import { QuestionEngine } from '../QuestionEngine';

function makeEngine() {
  const loader = new QuestionLoader();
  loader.load();
  return new QuestionEngine(loader);
}

describe('QuestionEngine 状态机', () => {
  it('start() 后进入 PERCEIVE 阶段', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    expect(engine.getStage()).toBe('PERCEIVE');
    expect(engine.currentQuestion()).not.toBeNull();
  });

  it('seed 路由：含"乱"路由到 name 阶段 n-001', () => {
    const engine = makeEngine();
    engine.start('界面太乱了');
    expect(engine.getStage()).toBe('NAME');
    expect(engine.currentQuestion()?.id).toBe('n-001');
  });

  it('seed 路由：含"圆角"路由到 spec 阶段 s-002', () => {
    const engine = makeEngine();
    engine.start('改圆角');
    expect(engine.getStage()).toBe('SPEC');
    expect(engine.currentQuestion()?.id).toBe('s-002');
  });

  it('answer() 推进流程', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    const first = engine.currentQuestion();
    expect(first?.id).toBe('p-001');
    // 选"修一个看不顺眼的 UI" → jump 到 p-002
    engine.answer('fix-ui', '修一个看不顺眼的 UI', ['场景: 修UI']);
    const next = engine.currentQuestion();
    expect(next?.id).toBe('p-002');
  });

  it('jump 规则生效', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    engine.answer('fix-ui', '修一个看不顺眼的 UI', ['场景: 修UI']);
    expect(engine.currentQuestion()?.id).toBe('p-002');
  });

  it('skip() 不产出意图标签 + consecutiveSkips 累加', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    const tagsBefore = engine.getIntentTags().length;
    engine.skip();
    expect(engine.getIntentTags().length).toBe(tagsBefore);
    // 第二次 skip
    engine.skip();
    // 连续 2 次 skip，snapshot.consecutiveSkips 应 ≥ 2
    expect(engine.snapshot().consecutiveSkips).toBeGreaterThanOrEqual(2);
  });

  it('完整流程跑完 5 阶段后 isComplete', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    // 顺序回答所有阶段所有问题
    let safety = 100;
    while (!engine.isComplete() && safety > 0) {
      const q = engine.currentQuestion();
      if (!q) break;
      if (q.options.length > 0) {
        const opt = q.options[0];
        engine.answer(opt.value, opt.label, opt.tags);
      } else {
        engine.answer('custom', '自定义回答', []);
      }
      safety--;
    }
    expect(engine.isComplete()).toBe(true);
    expect(engine.getStage()).toBe('COMPLETE');
  });

  it('intentTags 从 seed 提取', () => {
    const engine = makeEngine();
    engine.start('卡片太挤');
    const tags = engine.getIntentTags();
    expect(tags.some((t) => t.value.includes('间距太挤'))).toBe(true);
  });
});
