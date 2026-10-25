// src/components/__tests__/TemplateLibrary.test.tsx
// R05：TemplateLibrary / TemplateSaveDialog 组件测试（RTL）
// 验收标准落测：3 变量模板 → 3 个输入框 → 缺参禁止生成并高亮 → 补齐后插入
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateLibrary, TemplateSaveDialog } from '../TemplateLibrary';
import type { TemplateRow } from '@/lib/templateStore';

// Mock templateStore：内存列表 + 间谍记录保存调用
const store = vi.hoisted(() => ({
  rows: [] as TemplateRow[],
  saved: [] as Array<{ name: string; body: string; tags: string }>,
}));

vi.mock('@/lib/templateStore', () => ({
  saveTemplate: async (input: { name: string; body: string; tags: string }) => {
    store.saved.push({ name: input.name, body: input.body, tags: input.tags });
    const now = new Date().toISOString();
    store.rows.unshift({
      id: `id-${store.rows.length + 1}`,
      name: input.name,
      body: input.body,
      tags: input.tags,
      created_at: now,
      updated_at: now,
    });
    return store.rows[0].id;
  },
  listTemplates: async () => [...store.rows],
  deleteTemplate: async (id: string) => {
    const before = store.rows.length;
    store.rows = store.rows.filter((r) => r.id !== id);
    return store.rows.length < before;
  },
}));

function seedTemplate(body: string, name = '三变量模板') {
  const now = new Date().toISOString();
  store.rows.unshift({
    id: `id-${store.rows.length + 1}`,
    name,
    body,
    tags: '["UI"]',
    created_at: now,
    updated_at: now,
  });
}

describe('TemplateLibrary', () => {
  beforeEach(() => {
    store.rows = [];
    store.saved = [];
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('空态展示引导文案；展开后有模板则列出变量摘要', async () => {
    render(<TemplateLibrary onUse={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /我的模板（0）/ }));
    expect(screen.getByText('还没有保存的模板')).toBeInTheDocument();

    seedTemplate('把{{target}}间距改为{{间距}}px，配色用{{颜色}}');
    const { unmount } = render(<TemplateLibrary onUse={() => {}} />);
    // 计数经异步加载刷新，用 findBy 等待
    await userEvent.click(await screen.findByRole('button', { name: /我的模板（1）/ }));
    expect(await screen.findByText(/3 个变量：target、间距、颜色/)).toBeInTheDocument();
    unmount();
  });

  it('验收主链路：3 变量模板 → 3 个输入框 → 缺参点生成被拦并高亮 → 补齐后插入完整文本', async () => {
    seedTemplate('把{{target}}间距改为{{间距}}px，配色用{{颜色}}');
    const onUse = vi.fn();
    render(<TemplateLibrary onUse={onUse} />);

    await userEvent.click(await screen.findByRole('button', { name: /我的模板（1）/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^三变量模板/ }));

    // 三个输入框按变量名出现，数字类提示
    const dlg = screen.getByRole('dialog');
    expect(screen.getByLabelText(/target（文本）/)).toBeInTheDocument();
    expect(screen.getByLabelText(/间距（数字）/)).toBeInTheDocument();
    expect(screen.getByLabelText(/颜色（文本）/)).toBeInTheDocument();

    // 缺参点「生成并插入」：被拦 + alert 提示 + 高亮
    await userEvent.click(screen.getByRole('button', { name: /生成并插入/ }));
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('3 个变量未填写');
    expect(dlg.querySelectorAll('.text-semantic-error').length).toBeGreaterThan(0);

    // 补齐两个后仍缺一个 → 仍拦截
    await userEvent.type(screen.getByLabelText(/target（文本）/), '登录按钮');
    await userEvent.type(screen.getByLabelText(/间距（数字）/), '12');
    await userEvent.click(screen.getByRole('button', { name: /生成并插入/ }));
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('1 个变量未填写：颜色');

    // 全部补齐 → onUse 收到完整文本，对话框关闭
    await userEvent.type(screen.getByLabelText(/颜色（文本）/), '紫色');
    await userEvent.click(screen.getByRole('button', { name: /生成并插入/ }));
    expect(onUse).toHaveBeenCalledWith('把登录按钮间距改为12px，配色用紫色');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('无变量模板直接生成不弹输入框', async () => {
    seedTemplate('固定文案模板', '纯文本');
    const onUse = vi.fn();
    render(<TemplateLibrary onUse={onUse} />);
    await userEvent.click(await screen.findByRole('button', { name: /我的模板（1）/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^纯文本/ }));
    expect(screen.queryByLabelText(/（文本）/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /生成并插入/ }));
    expect(onUse).toHaveBeenCalledWith('固定文案模板');
  });

  it('删除模板后列表移除', async () => {
    seedTemplate('{{x}}', '待删模板');
    render(<TemplateLibrary onUse={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /我的模板（1）/ }));
    await userEvent.click(screen.getByRole('button', { name: '删除模板 待删模板' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /我的模板（0）/ })).toBeInTheDocument(),
    );
  });
});

describe('TemplateSaveDialog', () => {
  beforeEach(() => {
    store.rows = [];
    store.saved = [];
  });

  it('保存：名称/正文/标签入库，变量实时预览', async () => {
    const onClose = vi.fn();
    render(
      <TemplateSaveDialog initialBody="把{{target}}改为{{间距}}px" onClose={onClose} />,
    );
    expect(screen.getByLabelText('模板名称')).toHaveValue('未命名模板');
    expect(screen.getByText(/识别到 2 个变量：target、间距/)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('模板名称'));
    await userEvent.type(screen.getByLabelText('模板名称'), '间距调整');
    await userEvent.type(screen.getByLabelText('分类标签'), 'UI, 后端');
    await userEvent.click(screen.getByRole('button', { name: /保存模板/ }));

    await waitFor(() => expect(store.saved).toHaveLength(1));
    expect(store.saved[0].name).toBe('间距调整');
    expect(store.saved[0].body).toContain('{{间距}}');
    expect(JSON.parse(store.saved[0].tags)).toEqual(['UI', '后端']);
  });

  it('空正文禁用保存按钮', () => {
    render(<TemplateSaveDialog initialBody="" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /保存模板/ })).toBeDisabled();
  });

  it('插入按钮在正文光标处插入 {{}}', async () => {
    render(<TemplateSaveDialog initialBody="AB" onClose={() => {}} />);
    const body = screen.getByLabelText('模板正文') as HTMLTextAreaElement;
    body.focus();
    body.setSelectionRange(1, 1);
    await userEvent.click(screen.getByRole('button', { name: /插入 \{\{\}\}/ }));
    expect(body).toHaveValue('A{{}}B');
  });
});
