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

  // v1.2 新增：返回上一题（撤销最后一次回答）
  it('undoLastAnswer() 撤销最后一次回答', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    expect(engine.canUndo()).toBe(false);
    const firstQ = engine.currentQuestion();
    engine.answer('fix-ui', '修一个看不顺眼的 UI', ['场景: 修UI']);
    const secondQ = engine.currentQuestion();
    expect(secondQ?.id).not.toBe(firstQ?.id);
    expect(engine.canUndo()).toBe(true);
    // 撤销
    const result = engine.undoLastAnswer();
    expect(result.restored).toBe(true);
    expect(engine.currentQuestion()?.id).toBe(firstQ?.id);
    // answers 应被回滚
    expect(Object.keys(engine.getAnswers())).not.toContain(firstQ?.id);
  });

  it('undoLastAnswer() 在空历史时返回 restored=false', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    const result = engine.undoLastAnswer();
    expect(result.restored).toBe(false);
  });

  it('history 栈限制为 20', () => {
    const engine = makeEngine();
    engine.start('修 UI');
    // 连续回答 25 次（虽然有阶段推进，但每次都会 pushHistory）
    let safety = 25;
    while (!engine.isComplete() && safety > 0) {
      const q = engine.currentQuestion();
      if (!q) break;
      if (q.options.length > 0) {
        engine.answer(q.options[0].value, q.options[0].label, q.options[0].tags);
      } else {
        engine.answer('custom', '自定义', []);
      }
      safety--;
    }
    // 历史栈不应超过 20
    let undoCount = 0;
    while (engine.canUndo()) {
      engine.undoLastAnswer();
      undoCount++;
      if (undoCount > 25) break; // 防死循环
    }
    expect(undoCount).toBeLessThanOrEqual(20);
  });
});

// 三模式系统：PPT 场景测试
describe('QuestionEngine PPT 场景', () => {
  it('sceneChoice=ppt 时 start 返回 PPT 问题库首题 o-001', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    const q = engine.start('大赛展示', 'full', null, [], 'ppt');
    expect(q).not.toBeNull();
    expect(q?.id).toBe('o-001');
    expect(q?.stage).toBe('perceive');
    expect(engine.getScene()).toBe('ppt');
  });

  it('PPT 场景完整流程能跑完 5 阶段', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    engine.start('大赛展示', 'full', null, [], 'ppt');
    let safety = 30;
    while (!engine.isComplete() && safety > 0) {
      const q = engine.currentQuestion();
      if (!q) break;
      if (q.options.length > 0) {
        engine.answer(q.options[0].value, q.options[0].label, q.options[0].tags);
      } else {
        engine.answer('custom', '自定义回答', []);
      }
      safety--;
    }
    expect(engine.isComplete()).toBe(true);
    expect(engine.getStage()).toBe('COMPLETE');
  });

  it('PPT 场景 o-003 答题后能推进到 spec 阶段', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    engine.start('大赛展示', 'full', null, [], 'ppt');
    // 跳到 o-003（name 阶段）：答 o-001 选 new → jump o-003
    engine.answer('new', '从零开始做一份新 PPT', ['PPT: 新建']);
    expect(engine.currentQuestion()?.id).toBe('o-003');
    // 答 o-003（open 类型，输入主题）
    engine.answer('大赛展示', '大赛展示', []);
    // 应推进到 spec 阶段 o-004
    const next = engine.currentQuestion();
    expect(next).not.toBeNull();
    expect(next?.stage).toBe('spec');
    expect(next?.id).toBe('o-004');
  });
});

// P0-1（超时修复）：applyLLMAnalysis 延迟应用 LLM 分析
describe('QuestionEngine.applyLLMAnalysis（P0-1）', () => {
  function makeLLMAnalysis(overrides?: Partial<import('../LLMIntentAnalyzer').LLMIntentAnalysis>) {
    return {
      scene: 'frontend-ui',
      pain_points: [],
      detected_dimensions: [{ tag: '间距: 太挤', weight: 0.6, confidence: 0.8 }],
      urgency: 'medium',
      ambiguity_score: 0.2,
      suggested_followup: null,
      followup_options: [],
      source: 'llm',
      ...overrides,
    } as import('../LLMIntentAnalyzer').LLMIntentAnalysis;
  }

  it('未作答时，LLM 高歧义澄清题可替换规则路由的首题', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    // 规则路由：'修 UI' → p-001
    const first = engine.start('修 UI', 'full', null, [], 'auto');
    expect(first?.id).toBe('p-001');

    // LLM 判为高歧义，给出澄清题
    const analysis = makeLLMAnalysis({
      ambiguity_score: 0.8,
      suggested_followup: '你说的"修 UI"，是想调整整体风格还是修具体某个元素？',
      detected_dimensions: [],
    });

    const result = engine.applyLLMAnalysis(analysis);
    expect(result.replaced).toBe(true);
    expect(result.question?.id).toBe(engine.currentQuestion()?.id);
    expect(engine.currentQuestion()?.id).toMatch(/^dyn-llm-clarify-/);
    // 路由来源更新为 llm
    expect(engine.getRouteSource()).toBe('llm');
    // askedIds 同步为新的首题
    expect(engine.snapshot().askedIds).toEqual([engine.currentQuestion()?.id]);
  });

  it('未作答时，LLM 低歧义不换题但更新 tagScores 与意图标签', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    const first = engine.start('修 UI', 'full', null, [], 'auto');
    expect(first?.id).toBe('p-001');

    const analysis = makeLLMAnalysis({
      ambiguity_score: 0.2,
      detected_dimensions: [
        { tag: '间距: 太挤', weight: 0.7, confidence: 0.9 },
        { tag: '配色: 不协调', weight: 0.3, confidence: 0.8 },
      ],
    });

    const result = engine.applyLLMAnalysis(analysis);
    // 低歧义不换题（首题仍是 p-001）
    expect(result.replaced).toBe(false);
    expect(engine.currentQuestion()?.id).toBe('p-001');
    // tagScores 被 LLM dimensions 更新
    const scores = engine.getTagScores().map((s) => s.tag);
    expect(scores).toEqual(expect.arrayContaining(['间距: 太挤', '配色: 不协调']));
    // intentTags 补充了 LLM 分析标签
    expect(engine.getIntentTags().some((t) => t.source_question_id === 'llm-analysis')).toBe(true);
  });

  it('已作答后 applyLLMAnalysis 不换题（避免打断用户流程）', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    engine.start('修 UI', 'full', null, [], 'auto');
    // 用户已答首题
    const first = engine.currentQuestion();
    engine.answer('fix-ui', '修一个看不顺眼的 UI', ['场景: 修UI']);
    const answeredId = first?.id;

    const analysis = makeLLMAnalysis({ ambiguity_score: 0.8, suggested_followup: 'x' });
    const result = engine.applyLLMAnalysis(analysis);
    // 不应换题（当前仍为答题后的下一题，而非 LLM 澄清题）
    expect(result.replaced).toBe(false);
    expect(engine.currentQuestion()?.id).not.toMatch(/^dyn-llm-clarify-/);
    // 已作答记录保留
    expect(Object.keys(engine.getAnswers())).toContain(answeredId);
  });

  it('B4 修复：已作答后 applyLLMAnalysis 不覆盖 tagScores / 不注入 LLM 标签', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    engine.start('修 UI', 'full', null, [], 'auto');
    // 用户已答首题：认可了规则路由方向
    engine.answer('fix-ui', '修一个看不顺眼的 UI', ['场景: 修UI']);
    const tagScoresBefore = engine.getTagScores();

    // LLM 分析返回带 detected_dimensions，但用户已作答 → 不应覆盖 tagScores
    const analysis = makeLLMAnalysis({
      detected_dimensions: [{ tag: '风格: 极简', weight: 0.99, confidence: 0.9 }],
    });
    engine.applyLLMAnalysis(analysis);

    // tagScores 保持答后的规则聚合结果，未被 LLM 覆盖
    expect(engine.getTagScores()).toEqual(tagScoresBefore);
    // 不注入 LLM 来源的意图标签
    const llmTags = engine
      .getIntentTags()
      .filter((t) => t.source_question_id === 'llm-analysis');
    expect(llmTags.length).toBe(0);
  });

  it('重复 applyLLMAnalysis 不产生重复 LLM 意图标签（去重）', () => {
    const loader = new QuestionLoader();
    loader.load();
    const engine = new QuestionEngine(loader);
    engine.start('修 UI', 'full', null, [], 'auto');

    const analysis = makeLLMAnalysis({});
    engine.applyLLMAnalysis(analysis);
    engine.applyLLMAnalysis(analysis);

    const llmTags = engine
      .getIntentTags()
      .filter((t) => t.source_question_id === 'llm-analysis');
    expect(llmTags.length).toBeGreaterThan(0);
    // 去重：每对 label:value 只出现一次
    const keySet = new Set(llmTags.map((t) => `${t.label}:${t.value}`));
    expect(keySet.size).toBe(llmTags.length);
  });
});
