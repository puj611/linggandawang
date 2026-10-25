// src/components/settings/DataPanel.tsx
// R06 数据导出与导入面板（设置页「数据管理」分区）：
// 导出全部本地数据为 JSON（绝不含密钥）；导入支持合并/覆盖，导入前自动备份。
import { useState } from 'react';
import {
  exportData,
  downloadBundle,
  parseImportBundle,
  importData,
  type ImportResult,
} from '@/lib/dataExport';

type ImportPhase = 'idle' | 'confirm' | 'done' | 'error';

/** 读取文件文本：优先 File.text()，jsdom 等环境无该方法时走 FileReader */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

export function DataPanel() {
  const [exporting, setExporting] = useState(false);
  const [importPhase, setImportPhase] = useState<ImportPhase>('idle');
  // 待确认导入（选完文件、选好策略后需用户二次确认）
  const [pendingText, setPendingText] = useState('');
  const [pendingMode, setPendingMode] = useState<'merge' | 'overwrite'>('merge');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const bundle = await exportData();
      downloadBundle(bundle);
    } catch (e) {
      console.warn('[DataPanel] 导出失败', e);
    } finally {
      setExporting(false);
    }
  };

  const onFilePicked = async (file: File) => {
    try {
      const text = await readFileText(file);
      parseImportBundle(text); // 提前校验：非法文件在此给出明确错误
      setPendingText(text);
      setImportPhase('confirm');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImportPhase('error');
    }
  };

  const onConfirmImport = async () => {
    try {
      const bundle = parseImportBundle(pendingText);
      const r = await importData(bundle, pendingMode);
      setResult(r);
      setImportPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImportPhase('error');
    }
  };

  const reset = () => {
    setImportPhase('idle');
    setPendingText('');
    setResult(null);
    setError('');
  };

  return (
    <div className="pt-3 border-t border-border">
      <div className="text-[11px] text-text-secondary mb-2">数据管理</div>
      <div className="text-[10px] text-text-tertiary mb-2 leading-relaxed">
        导出全部本地数据（提示词历史、偏好、变量模板）为单个 JSON。导出内容<b>绝不包含 API
        密钥</b>（密钥只存在系统凭据管理器）。导入前会自动备份当前数据。
      </div>

      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={exporting}
          className="flex-1 px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-surface-2 transition-colors disabled:opacity-50"
        >
          {exporting ? '导出中…' : '导出数据 (.json)'}
        </button>

        <label className="flex-1 px-3 py-1.5 text-xs rounded-btn border border-border text-text-primary hover:bg-surface-2 transition-colors cursor-pointer text-center">
          导入数据
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="选择导入文件"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ''; // 允许重复选择同一文件
              if (f) void onFilePicked(f);
            }}
          />
        </label>
      </div>

      {importPhase === 'confirm' && (
        <div className="rounded-btn border border-border bg-surface-2/50 p-3 flex flex-col gap-2" role="dialog" aria-label="确认导入">
          <div className="text-xs text-text-primary">确认导入</div>
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="import-mode"
                checked={pendingMode === 'merge'}
                onChange={() => setPendingMode('merge')}
              />
              合并（保留现有数据，追加导入）
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="import-mode"
                checked={pendingMode === 'overwrite'}
                onChange={() => setPendingMode('overwrite')}
              />
              覆盖（清空后还原，导入前自动备份）
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={reset} className="ghost-btn px-3 py-1 text-xs">
              取消
            </button>
            <button
              type="button"
              onClick={() => void onConfirmImport()}
              className="primary-btn px-3 py-1 text-xs"
            >
              开始导入
            </button>
          </div>
        </div>
      )}

      {importPhase === 'done' && result && (
        <div className="text-[10px] text-semantic-success" role="status">
          导入完成（{result.mode === 'merge' ? '合并' : '覆盖'}）：新增历史 {result.historyInserted} 条、
          偏好 {result.preferencesWritten} 项、模板 {result.templatesWritten} 个。
          <button type="button" onClick={reset} className="ml-2 text-text-tertiary underline">
            关闭
          </button>
        </div>
      )}

      {importPhase === 'error' && (
        <div className="text-[10px] text-semantic-error" role="alert">
          {error}
          <button type="button" onClick={reset} className="ml-2 underline">
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
