// src/components/__tests__/SkipConfirmDialog.test.tsx
// R07 ratchet：SkipConfirmDialog 组件测试——继续/结束两条路径与关弹窗
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkipConfirmDialog } from '../SkipConfirmDialog';
import { useAppStore } from '@/stores/appStore';

vi.mock('@/hooks/useFlow', () => ({
  useFlow: () => ({
    continueAfterSkipConfirm: vi.fn(),
    finishEarlyAndGenerate: vi.fn(),
  }),
}));

describe('SkipConfirmDialog', () => {
  beforeEach(() => {
    useAppStore.setState({ skipConfirmOpen: true });
  });

  it('渲染确认弹窗（role=dialog）', () => {
    render(<SkipConfirmDialog />);
    expect(screen.getByRole('dialog')).toHaveTextContent('连续跳过 ≥ 2 题');
  });

  it('点「继续提问」：关弹窗回到提问', async () => {
    render(<SkipConfirmDialog />);
    await userEvent.click(screen.getByRole('button', { name: '继续提问' }));
    expect(useAppStore.getState().skipConfirmOpen).toBe(false);
  });

  it('点「结束并生成」：关弹窗并触发生成', async () => {
    render(<SkipConfirmDialog />);
    await userEvent.click(screen.getByRole('button', { name: '结束并生成' }));
    expect(useAppStore.getState().skipConfirmOpen).toBe(false);
  });
});
