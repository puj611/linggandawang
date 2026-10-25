// src/components/__tests__/ui.test.tsx
// R07：RTL 组件测试基建首批——ui 三件套 + StartTemplates
// 背景（R04 轮 P1 教训）：纯单测无法发现「组件挂载/卸载丢态」类集成缺陷，此文件即基建样板
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { ErrorBanner } from '../ui/ErrorBanner';
import { StartTemplates } from '../StartTemplates';

describe('EmptyState', () => {
  it('默认渲染「暂无内容」标题', () => {
    render(<EmptyState />);
    expect(screen.getByText('暂无内容')).toBeInTheDocument();
  });

  it('自定义标题与描述', () => {
    render(<EmptyState title="还没有历史记录" description="生成第一条提示词后显示在这里" />);
    expect(screen.getByText('还没有历史记录')).toBeInTheDocument();
    expect(screen.getByText('生成第一条提示词后显示在这里')).toBeInTheDocument();
  });

  it('action 插槽可交互', async () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="空"
        action={
          <button onClick={onAction} type="button">
            创建
          </button>
        }
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('Spinner', () => {
  it('默认无标签，role=status 可访问', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/加载/)).not.toBeInTheDocument();
  });

  it('带标签时展示文案', () => {
    render(<Spinner label="模型加载中" />);
    expect(screen.getByText('模型加载中')).toBeInTheDocument();
  });
});

describe('ErrorBanner', () => {
  it('error 变体 role=alert，展示消息', () => {
    render(<ErrorBanner message="网络请求失败" />);
    expect(screen.getByRole('alert')).toHaveTextContent('网络请求失败');
  });

  it('点击关闭：组件卸载并回调 onDismiss', async () => {
    const onDismiss = vi.fn();
    const { container } = render(<ErrorBanner message="出错了" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(container.firstChild).toBeNull();
  });

  it('message 变化时重新显示（ dismissed 重置）', async () => {
    const { rerender } = render(<ErrorBanner message="第一次" />);
    await userEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<ErrorBanner message="第二次" />);
    expect(screen.getByRole('alert')).toHaveTextContent('第二次');
  });

  it('warning 变体 role=status（非 assertive）', () => {
    render(<ErrorBanner message="降级提示" variant="warning" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('StartTemplates', () => {
  it('渲染 3 个快速起点按钮', () => {
    render(<StartTemplates onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /修一个看不顺眼的地方/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /加一个细节/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /复制一个产品的特性/ })).toBeInTheDocument();
  });

  it('点击模板回调对应 seed（按钮 label 与 seed 不同，验证映射正确）', async () => {
    const onPick = vi.fn();
    render(<StartTemplates onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: /加一个细节/ }));
    expect(onPick).toHaveBeenCalledWith('给现有功能加一个细节');
  });
});
