// src/stores/__tests__/appStore.compare.test.ts
// R04 P1 回归：A/B 对比槽位必须存于 appStore（而非 ComparePanel 本地 state），
// 否则「载入 A → 关面板（组件卸载）→ 重新生成 → 开面板 → 载入 B」链路丢失 A，无法并排对比。
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import type { PromptResult } from '@/types/prompt';

function makeResult(tag: string): PromptResult {
  return {
    project_context: null,
    action: { title: '要做什么', content: `动作-${tag}` },
    spec: { title: '怎么做', content: `规格-${tag}` },
    constraint: { title: '不能怎么', content: `约束-${tag}` },
    verify: { title: '怎么算做好了', content: `验证-${tag}` },
    raw_quotes: [],
    intent_tags: [],
    generated_at: '2026-10-24T00:00:00.000Z',
  };
}

describe('appStore · 对比槽位（R04 P1 回归）', () => {
  beforeEach(() => {
    useAppStore.setState({
      compareOpen: false,
      compareLeft: null,
      compareRight: null,
      settingsOpen: false,
      skipConfirmOpen: false,
    });
  });

  it('初始 A/B 槽位为空且面板关闭', () => {
    const s = useAppStore.getState();
    expect(s.compareLeft).toBeNull();
    expect(s.compareRight).toBeNull();
    expect(s.compareOpen).toBe(false);
  });

  it('setCompareSlot 分别写入 A/B 两侧，互不干扰', () => {
    const a = makeResult('A');
    const b = makeResult('B');
    useAppStore.getState().setCompareSlot('left', a);
    expect(useAppStore.getState().compareLeft).toBe(a);
    expect(useAppStore.getState().compareRight).toBeNull();

    useAppStore.getState().setCompareSlot('right', b);
    expect(useAppStore.getState().compareLeft).toBe(a);
    expect(useAppStore.getState().compareRight).toBe(b);
  });

  it('setCompareSlot(null) 仅清空指定一侧', () => {
    const a = makeResult('A');
    const b = makeResult('B');
    const store = useAppStore.getState();
    store.setCompareSlot('left', a);
    store.setCompareSlot('right', b);
    useAppStore.getState().setCompareSlot('left', null);
    expect(useAppStore.getState().compareLeft).toBeNull();
    expect(useAppStore.getState().compareRight).toBe(b);
  });

  it('P1 核心：关闭面板（ComparePanel 卸载）后槽位不丢', () => {
    const a = makeResult('A');
    useAppStore.getState().setCompareSlot('left', a);
    useAppStore.getState().openCompare();
    useAppStore.getState().closeCompare();
    expect(useAppStore.getState().compareOpen).toBe(false);
    // 关面板不清空槽位——重新打开后 A 仍在
    expect(useAppStore.getState().compareLeft).toBe(a);
  });

  it('collapse / backToExpanded 关闭面板但保留槽位', () => {
    const a = makeResult('A');
    const b = makeResult('B');
    const store = useAppStore.getState();
    store.setCompareSlot('left', a);
    store.setCompareSlot('right', b);
    useAppStore.getState().openCompare();

    useAppStore.getState().collapse();
    expect(useAppStore.getState().compareOpen).toBe(false);
    expect(useAppStore.getState().compareLeft).toBe(a);
    expect(useAppStore.getState().compareRight).toBe(b);

    useAppStore.getState().openCompare();
    useAppStore.getState().backToExpanded();
    expect(useAppStore.getState().compareOpen).toBe(false);
    expect(useAppStore.getState().compareLeft).toBe(a);
    expect(useAppStore.getState().compareRight).toBe(b);
  });

  it('swapCompareSlots 交换 A/B（含单侧为空）', () => {
    const a = makeResult('A');
    useAppStore.getState().setCompareSlot('left', a);
    useAppStore.getState().swapCompareSlots();
    expect(useAppStore.getState().compareLeft).toBeNull();
    expect(useAppStore.getState().compareRight).toBe(a);

    const b = makeResult('B');
    useAppStore.getState().setCompareSlot('left', b);
    useAppStore.getState().swapCompareSlots();
    expect(useAppStore.getState().compareLeft).toBe(a);
    expect(useAppStore.getState().compareRight).toBe(b);
  });

  it('openCompare / closeCompare 仅切换开合，不影响槽位内容', () => {
    const a = makeResult('A');
    useAppStore.getState().setCompareSlot('left', a);
    useAppStore.getState().openCompare();
    expect(useAppStore.getState().compareOpen).toBe(true);
    expect(useAppStore.getState().compareLeft).toBe(a);
    useAppStore.getState().closeCompare();
    expect(useAppStore.getState().compareOpen).toBe(false);
    expect(useAppStore.getState().compareLeft).toBe(a);
  });
});
