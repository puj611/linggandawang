// src/components/__tests__/DataPanel.test.tsx
// R06：DataPanel 组件测试——导出按钮、非法文件明确报错、导入确认流
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataPanel } from '../settings/DataPanel';
import * as dataExport from '@/lib/dataExport';

describe('DataPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('导出按钮调用 exportData + downloadBundle', async () => {
    const exportSpy = vi.spyOn(dataExport, 'exportData').mockResolvedValue({
      schemaVersion: 1, appVersion: '0.9.1', exportedAt: '2026-10-25T00:00:00Z',
      data: { promptHistory: [], preferences: [], templates: [] },
    });
    const downloadSpy = vi.spyOn(dataExport, 'downloadBundle').mockImplementation(() => {});
    render(<DataPanel />);
    await userEvent.click(screen.getByRole('button', { name: /导出数据/ }));
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });

  it('选择非法 JSON 文件：明确报错且不进入确认流程', async () => {
    render(<DataPanel />);
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('选择导入文件'), file);
    expect(screen.getByRole('alert')).toHaveTextContent('不是合法 JSON');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('版本不匹配文件：报 schema 版本错误', async () => {
    render(<DataPanel />);
    const file = new File([JSON.stringify({ schemaVersion: 99 })], 'v99.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('选择导入文件'), file);
    expect(screen.getByRole('alert')).toHaveTextContent('schema 版本为 99');
  });

  it('合法文件进入确认 → 选覆盖 → 导入完成展示统计', async () => {
    const bundle = {
      schemaVersion: 1, appVersion: '0.9.1', exportedAt: '2026-10-25T00:00:00Z',
      data: {
        promptHistory: [{ title: 'H', markdown: 'm', tags: [], seed_input: 's', created_at: '2026-10-01', updated_at: '2026-10-01' }],
        preferences: [{ key: 'k', value: '1' }],
        templates: [],
      },
    };
    const importSpy = vi
      .spyOn(dataExport, 'importData')
      .mockResolvedValue({ mode: 'overwrite', historyInserted: 1, preferencesWritten: 1, templatesWritten: 0 });
    render(<DataPanel />);
    const file = new File([JSON.stringify(bundle)], 'ok.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('选择导入文件'), file);

    // 确认对话框出现；默认合并，切到覆盖
    expect(screen.getByRole('dialog')).toHaveTextContent('确认导入');
    await userEvent.click(screen.getByLabelText(/覆盖（清空后还原/));
    await userEvent.click(screen.getByRole('button', { name: '开始导入' }));

    expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 1 }), 'overwrite');
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('新增历史 1 条');
    expect(status).toHaveTextContent('偏好 1 项');
  });
});
