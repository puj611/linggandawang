// src/components/ProjectScanDashboard.tsx
// M10: 项目扫描仪表盘 - 展示深度扫描结果
import { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { fullScanProject } from '@/lib/projectScanner';
import type { FullScanResult } from '@/types/project';

interface Props {
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusColor(status: string): string {
  if (status.includes('M')) return 'text-[#e2b93d]';
  if (status.includes('A')) return 'text-[#7DD29D]';
  if (status.includes('D')) return 'text-[#D97757]';
  if (status.includes('?')) return 'text-text-tertiary';
  return 'text-text-secondary';
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    'M': '修改',
    'A': '新增',
    'D': '删除',
    'R': '重命名',
    '??': '未跟踪',
    '!!': '忽略',
  };
  for (const [key, label] of Object.entries(map)) {
    if (status.includes(key)) return label;
  }
  return status;
}

function getTagColor(tag: string): string {
  const map: Record<string, string> = {
    'TODO': 'bg-[#2A2D1F] text-[#e2b93d]',
    'FIXME': 'bg-[#3D1F1F] text-[#D97757]',
    'HACK': 'bg-[#3D2F1F] text-[#ffd580]',
    'XXX': 'bg-[#2F1F3D] text-[#B08DD4]',
    'BUG': 'bg-[#3D1F2A] text-[#E879A0]',
  };
  return map[tag] || 'bg-bg-main text-text-secondary';
}

export function ProjectScanDashboard({ onClose }: Props) {
  const fingerprint = useProjectStore((s) => s.fingerprint);
  const [result, setResult] = useState<FullScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'files' | 'git' | 'deps' | 'todos'>('overview');

  const handleScan = useCallback(async () => {
    if (!fingerprint?.path) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fullScanProject(fingerprint.path);
      if (res) {
        setResult(res);
      } else {
        setError('深度扫描不可用（仅 Tauri 桌面端支持）');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  }, [fingerprint?.path]);

  useEffect(() => {
    if (fingerprint?.path && !result && !scanning) {
      handleScan();
    }
  }, [fingerprint?.path]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!fingerprint) return null;

  const tabs = [
    { key: 'overview' as const, label: '概览' },
    { key: 'files' as const, label: '文件' },
    { key: 'git' as const, label: 'Git' },
    { key: 'deps' as const, label: '依赖' },
    { key: 'todos' as const, label: 'TODO' },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 no-drag"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-h-[560px] bg-bg-card border border-border rounded-card shadow-popover flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text-primary font-semibold">项目扫描仪表盘</div>
            <div className="text-[10px] text-text-tertiary truncate">{fingerprint.name}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-2.5 py-1 text-[10px] rounded-btn bg-brand hover:bg-brand-hover text-white transition-colors disabled:opacity-50"
            >
              {scanning ? '扫描中…' : '重新扫描'}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-btn text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors"
              aria-label="关闭"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab 栏 */}
        <div className="flex border-b border-border flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-3 py-2 text-[11px] transition-colors ${
                activeTab === tab.key
                  ? 'text-brand border-b-2 border-brand'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 text-[10px] text-[#D97757] bg-[#3D241F] rounded px-2 py-1">{error}</div>
          )}

          {scanning && !result && (
            <div className="flex items-center justify-center py-12 text-text-tertiary text-[11px]">
              <svg className="animate-spin mr-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              正在扫描项目…
            </div>
          )}

          {result && activeTab === 'overview' && (
            <div className="space-y-4">
              {/* 扫描耗时 */}
              <div className="text-[10px] text-text-tertiary">
                扫描耗时 {result.scan_time_ms}ms
              </div>

              {/* 文件统计 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-bg-main rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold text-text-primary">{result.file_tree.total_files}</div>
                  <div className="text-[10px] text-text-secondary mt-0.5">文件</div>
                </div>
                <div className="bg-bg-main rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold text-text-primary">{result.file_tree.total_dirs}</div>
                  <div className="text-[10px] text-text-secondary mt-0.5">目录</div>
                </div>
                <div className="bg-bg-main rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold text-text-primary">{formatSize(result.file_tree.total_size)}</div>
                  <div className="text-[10px] text-text-secondary mt-0.5">总大小</div>
                </div>
              </div>

              {/* 文件类型分布 */}
              <div>
                <div className="text-[11px] text-text-secondary mb-2">文件类型分布</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(result.file_tree.by_extension)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 12)
                    .map(([ext, count]) => (
                      <span key={ext} className="px-1.5 py-0.5 text-[9px] bg-bg-main text-text-secondary rounded">
                        .{ext} ({count})
                      </span>
                    ))}
                </div>
              </div>

              {/* Git 概况 */}
              {result.git.is_repo && (
                <div className="bg-bg-main rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-text-secondary">Git</span>
                    {result.git.branch && (
                      <span className="px-1.5 py-0.5 text-[9px] bg-[#1F2540] text-[#8B9AE8] rounded">
                        {result.git.branch}
                      </span>
                    )}
                    {result.git.changed_files.length > 0 && (
                      <span className="px-1.5 py-0.5 text-[9px] bg-[#3D2F1F] text-[#ffd580] rounded">
                        {result.git.changed_files.length} 变更
                      </span>
                    )}
                  </div>
                  {result.git.recent_commits.length > 0 && (
                    <div className="text-[9px] text-text-tertiary mt-1">
                      最近：{result.git.recent_commits[0].message}
                    </div>
                  )}
                </div>
              )}

              {/* 依赖概览 */}
              <div className="bg-bg-main rounded-lg p-3">
                <div className="text-[11px] text-text-secondary mb-1">依赖</div>
                <div className="flex gap-3 text-[10px]">
                  <span className="text-text-primary">{Object.keys(result.dependencies.dependencies).length} 生产</span>
                  <span className="text-text-secondary">{Object.keys(result.dependencies.dev_dependencies).length} 开发</span>
                  {result.dependencies.lock_file && (
                    <span className="text-text-tertiary">锁文件: {result.dependencies.lock_file}</span>
                  )}
                </div>
              </div>

              {/* TODO/FIXME 概况 */}
              {result.todos.length > 0 && (
                <div className="bg-bg-main rounded-lg p-3">
                  <div className="text-[11px] text-text-secondary mb-1">
                    标记 <span className="text-[#D97757]">{result.todos.length}</span> 处
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'] as const).map((tag) => {
                      const count = result.todos.filter((t) => t.tag === tag).length;
                      if (count === 0) return null;
                      return (
                        <span key={tag} className={`px-1 py-0.5 text-[9px] rounded ${getTagColor(tag)}`}>
                          {tag} ({count})
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {result && activeTab === 'files' && (
            <div className="space-y-2">
              <div className="text-[10px] text-text-tertiary mb-2">
                共 {result.file_tree.total_files} 文件，{result.file_tree.total_dirs} 目录
              </div>
              <div className="max-h-[320px] overflow-y-auto space-y-0.5 font-mono text-[10px]">
                {result.file_tree.entries.slice(0, 200).map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5 hover:bg-bg-main rounded px-1">
                    <span className={entry.is_dir ? 'text-[#8B9AE8]' : 'text-text-secondary'}>
                      {entry.is_dir ? '📁' : '📄'}
                    </span>
                    <span className="text-text-primary truncate flex-1">{entry.path}</span>
                    {!entry.is_dir && entry.size > 0 && (
                      <span className="text-text-tertiary flex-shrink-0">{formatSize(entry.size)}</span>
                    )}
                  </div>
                ))}
                {result.file_tree.entries.length > 200 && (
                  <div className="text-[10px] text-text-tertiary text-center py-2">
                    … 仅显示前 200 条
                  </div>
                )}
              </div>
            </div>
          )}

          {result && activeTab === 'git' && (
            <div className="space-y-4">
              {!result.git.is_repo ? (
                <div className="text-[11px] text-text-tertiary py-8 text-center">不是 Git 仓库</div>
              ) : (
                <>
                  <div>
                    <div className="text-[11px] text-text-secondary mb-2">变更文件</div>
                    {result.git.changed_files.length === 0 ? (
                      <div className="text-[10px] text-text-tertiary">无变更</div>
                    ) : (
                      <div className="space-y-1">
                        {result.git.changed_files.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px]">
                            <span className={`w-5 text-center ${getStatusColor(f.status)}`}>
                              {getStatusLabel(f.status)}
                            </span>
                            <span className="text-text-primary truncate">{f.path}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-text-secondary mb-2">最近提交</div>
                    <div className="space-y-1.5">
                      {result.git.recent_commits.map((c, i) => (
                        <div key={i} className="text-[10px]">
                          <div className="flex items-center gap-2">
                            <span className="text-[#8B9AE8] font-mono">{c.hash}</span>
                            <span className="text-text-primary truncate">{c.message}</span>
                          </div>
                          <div className="text-text-tertiary mt-0.5">
                            {c.author} · {c.date}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {result && activeTab === 'deps' && (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] text-text-secondary mb-2">
                  生产依赖 ({Object.keys(result.dependencies.dependencies).length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(result.dependencies.dependencies).map(([name, ver]) => (
                    <span key={name} className="px-1.5 py-0.5 text-[9px] bg-[#1F2540] text-[#8B9AE8] rounded">
                      {name} <span className="text-text-tertiary">{ver}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-secondary mb-2">
                  开发依赖 ({Object.keys(result.dependencies.dev_dependencies).length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(result.dependencies.dev_dependencies).map(([name, ver]) => (
                    <span key={name} className="px-1.5 py-0.5 text-[9px] bg-bg-main text-text-secondary rounded">
                      {name} <span className="text-text-tertiary">{ver}</span>
                    </span>
                  ))}
                </div>
              </div>
              {Object.keys(result.dependencies.scripts).length > 0 && (
                <div>
                  <div className="text-[11px] text-text-secondary mb-2">Scripts</div>
                  <div className="space-y-1">
                    {Object.entries(result.dependencies.scripts).map(([name, cmd]) => (
                      <div key={name} className="flex items-center gap-2 text-[10px]">
                        <span className="text-[#7DD29D]">{name}</span>
                        <span className="text-text-tertiary font-mono truncate">{cmd}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.dependencies.tsconfig_paths && (
                <div>
                  <div className="text-[11px] text-text-secondary mb-2">TSConfig Paths</div>
                  <div className="space-y-1">
                    {Object.entries(result.dependencies.tsconfig_paths).map(([alias, target]) => (
                      <div key={alias} className="flex items-center gap-2 text-[10px]">
                        <span className="text-[#ffd580]">{alias}</span>
                        <span className="text-text-tertiary">→</span>
                        <span className="text-text-primary font-mono">{target}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {result && activeTab === 'todos' && (
            <div className="space-y-2">
              {result.todos.length === 0 ? (
                <div className="text-[11px] text-text-tertiary py-8 text-center">无 TODO/FIXME 标记</div>
              ) : (
                <>
                  <div className="text-[10px] text-text-tertiary mb-2">
                    共 {result.todos.length} 处标记
                  </div>
                  <div className="space-y-1.5">
                    {result.todos.map((item, i) => (
                      <div key={i} className="bg-bg-main rounded p-2 text-[10px]">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`px-1 py-0.5 text-[9px] rounded font-medium ${getTagColor(item.tag)}`}>
                            {item.tag}
                          </span>
                          <span className="text-text-tertiary">{item.file}:{item.line}</span>
                        </div>
                        <div className="text-text-primary">{item.content}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end px-4 py-2.5 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1 text-[10px] rounded-btn border border-border text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
