// src/stores/__tests__/contextStore.test.ts
// 死锁回归测试：验证 appendRecentQA 等方法不再嵌套 enqueue 死锁
import { describe, it, expect } from 'vitest';
import { useContextStore } from '../contextStore';

describe('contextStore 死锁回归', () => {
  it('appendRecentQA 能在 2s 内 resolve（不死锁）', async () => {
    const store = useContextStore.getState();
    const start = Date.now();
    await store.appendRecentQA({
      question_id: 'test-001',
      question_text: '测试问题',
      answer: '测试答案',
      answered_at: new Date().toISOString(),
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('连续多次 appendRecentQA 都能完成（串行化不阻塞）', async () => {
    const store = useContextStore.getState();
    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      await store.appendRecentQA({
        question_id: `test-${i}`,
        question_text: `问题${i}`,
        answer: `答案${i}`,
        answered_at: new Date().toISOString(),
      });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    // 验证最后一条已写入
    const list = store.getRecentQA();
    expect(list.length).toBeGreaterThanOrEqual(5);
  });

  it('appendPreference 能在 2s 内 resolve（不死锁）', async () => {
    const store = useContextStore.getState();
    const start = Date.now();
    await store.appendPreference({
      key: '场景',
      value: 'PPT',
      confirmed_at: new Date().toISOString(),
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('setIntentTags 能在 2s 内 resolve（不死锁）', async () => {
    const store = useContextStore.getState();
    const start = Date.now();
    await store.setIntentTags([
      { id: 't1', label: '场景', value: 'PPT', stage: 'perceive', source_question_id: 'o-001', source_type: 'option', confidence: 0.9, deletable: true, created_at: new Date().toISOString() },
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('appendPreferences 批量写入不死锁', async () => {
    const store = useContextStore.getState();
    const start = Date.now();
    await store.appendPreferences([
      { key: '场景', value: 'PPT', confirmed_at: new Date().toISOString() },
      { key: '受众', value: '技术', confirmed_at: new Date().toISOString() },
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
