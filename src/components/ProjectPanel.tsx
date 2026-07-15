// src/components/ProjectPanel.tsx
// 项目详情浮层：技术栈标签、目录结构、约定、操作
import { useEffect, useState } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { pickProjectFolder, scanProject } from '@/lib/projectScanner';
import {
  FRAMEWORK_LABELS,
  CSS_LABELS,
  BUILD_LABELS,
  PM_LABELS,
  PROJECT_TYPE_LABELS,
} from '@/lib/tech-rules';
import { ProjectScanDashboard } from './ProjectScanDashboard';
import { RequirementSyncPanel } from './RequirementSyncPanel';

interface Props {
  onClose: () => void;
}

export function ProjectPanel({ onClose }: Props) {
  const fingerprint = useProjectStore((s) => s.fingerprint);
  const scanning = useProjectStore((s) => s.scanning);
  const error = useProjectStore((s) => s.error);
  const setFingerprint = useProjectStore((s) => s.setFingerprint);
  const setScanning = useProjectStore((s) => s.setScanning);
  const setError = useProjectStore((s) => s.setError);
  const clearProject = useProjectStore((s) => s.clear);

  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showRequirementSync, setShowRequirementSync] = useState(false);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleRescan = async () => {
    if (!fingerprint?.path) return;
    setScanning(true);
    setError(null);
    try {
      const fp = await scanProject(fingerprint.path);
      await setFingerprint(fp);
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const handlePickFolder = async () => {
    setScanning(true);
    setError(null);
    try {
      const path = await pickProjectFolder();
      if (path) {
        const fp = await scanProject(path);
        await setFingerprint(fp);
      } else {
        // 浏览器模式下文件夹选择不可用，自动降级为演示扫描
        const fp = await scanProject('');
        await setFingerprint(fp);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '选择项目失败');
    } finally {
      setScanning(false);
    }
  };

  const handleDemoScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const fp = await scanProject('');
      await setFingerprint(fp);
    } catch (e) {
      setError(e instanceof Error ? e.message : '演示扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const handleUnbind = () => {
    if (!confirmUnbind) {
      setConfirmUnbind(true);
      setTimeout(() => setConfirmUnbind(false), 3000);
      return;
    }
    clearProject();
    onClose();
  };

  if (!fingerprint) return null;

  const tags: { label: string; color: string }[] = [];
  if (fingerprint.project_type) {
    tags.push({ label: PROJECT_TYPE_LABELS[fingerprint.project_type] ?? fingerprint.project_type, color: 'bg-[#2A1F3D] text-brand' });
  }
  if (fingerprint.framework) {
    tags.push({ label: FRAMEWORK_LABELS[fingerprint.framework] ?? fingerprint.framework, color: 'bg-[#1F2540] text-[#8B9AE8]' });
  }
  if (fingerprint.language === 'typescript') {
    tags.push({ label: 'TypeScript', color: 'bg-[#1F3A3D] text-[#5EB9C4]' });
  }
  if (fingerprint.css_solution) {
    tags.push({ label: CSS_LABELS[fingerprint.css_solution] ?? fingerprint.css_solution, color: 'bg-[#3D2F1F] text-[#ffd580]' });
  }
  if (fingerprint.build_tool) {
    tags.push({ label: BUILD_LABELS[fingerprint.build_tool] ?? fingerprint.build_tool, color: 'bg-bg-main text-text-secondary' });
  }
  if (fingerprint.package_manager) {
    tags.push({ label: PM_LABELS[fingerprint.package_manager] ?? fingerprint.package_manager, color: 'bg-bg-main text-text-secondary' });
  }
  for (const lib of fingerprint.ui_libraries) {
    tags.push({ label: lib, color: 'bg-[#2A1F3D] text-brand' });
  }
  for (const sm of fingerprint.state_management) {
    tags.push({ label: sm, color: 'bg-[#1F3D2B] text-[#7DD29D]' });
  }

  const structure = fingerprint.structure;
  const structItems = [
    { key: 'has_components', label: 'components' },
    { key: 'has_hooks', label: 'hooks' },
    { key: 'has_stores', label: 'stores' },
    { key: 'has_pages', label: 'pages/views' },
    { key: 'has_lib', label: 'lib/utils' },
    { key: 'has_types', label: 'types' },
    { key: 'has_assets', label: 'assets' },
    { key: 'has_tests', label: 'tests' },
  ] as const;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[10000] flex items-center justify-center p-4 no-drag"
      onClick={onClose}
    >
      <div
        className="w-[380px] max-h-[500px] bg-bg-card border border-border rounded-card shadow-popover flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text-primary font-semibold truncate">{fingerprint.name}</div>
            <div className="text-[10px] text-text-tertiary truncate" title={fingerprint.path}>{fingerprint.path}</div>
          </div>
          <button
            onClick={onClose}
            className="ml-2 p-1 rounded-btn text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors flex-shrink-0"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 技术栈标签 */}
          <div>
            <div className="text-[11px] text-text-secondary mb-2">技术栈</div>
            <div className="flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <span className="text-[10px] text-text-tertiary">未能识别</span>
              ) : (
                tags.map((t, i) => (
                  <span key={i} className={`px-1.5 py-0.5 rounded text-[9px] ${t.color}`}>{t.label}</span>
                ))
              )}
            </div>
            {fingerprint.detected_features.length > 0 && (
              <div className="mt-2 text-[9px] text-text-tertiary">
                其他工具：{fingerprint.detected_features.filter(f => !tags.some(t => t.label === f)).join(' · ')}
              </div>
            )}
          </div>

          {/* 目录结构 */}
          <div>
            <div className="text-[11px] text-text-secondary mb-2">目录结构</div>
            <div className="grid grid-cols-2 gap-y-1 gap-x-2">
              {structItems.map((item) => {
                const ok = structure[item.key];
                return (
                  <div key={item.key} className="flex items-center gap-1.5 text-[10px]">
                    <span className={ok ? 'text-brand' : 'text-text-tertiary'}>
                      {ok ? '✓' : '·'}
                    </span>
                    <span className={ok ? 'text-text-primary' : 'text-text-tertiary'}>src/{item.label}</span>
                  </div>
                );
              })}
            </div>
            {structure.src_layout.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {structure.src_layout.filter(d => !['components', 'hooks', 'stores', 'pages', 'views', 'app', 'lib', 'utils', 'types', 'typings', '@types', 'assets', 'public', 'static', '__tests__', 'test'].includes(d.toLowerCase())).map((d) => (
                  <span key={d} className="px-1 py-0.5 text-[9px] text-text-secondary bg-bg-main rounded">src/{d}</span>
                ))}
              </div>
            )}
          </div>

          {/* 约定 */}
          {fingerprint.conventions.length > 0 && (
            <div>
              <div className="text-[11px] text-text-secondary mb-2">已识别约定</div>
              <ul className="space-y-1">
                {fingerprint.conventions.map((c, i) => (
                  <li key={i} className="flex gap-2 text-[10px] text-text-secondary">
                    <span className="text-brand flex-shrink-0">·</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="text-[10px] text-[#D97757] bg-[#3D241F] rounded px-2 py-1">{error}</div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border flex-shrink-0">
          <button
            onClick={handleUnbind}
            className={`px-2.5 py-1 text-[10px] rounded-btn transition-colors ${
              confirmUnbind
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'text-text-tertiary hover:text-[#D97757]'
            }`}
          >
            {confirmUnbind ? '再次点击确认解绑' : '解绑项目'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePickFolder}
              disabled={scanning}
              className="px-2.5 py-1 text-[10px] rounded-btn border border-border text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors disabled:opacity-50"
              title="选择其他项目文件夹"
            >
              切换项目
            </button>
            <button
              onClick={handleDemoScan}
              disabled={scanning}
              className="px-2.5 py-1 text-[10px] rounded-btn border border-border text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors disabled:opacity-50"
              title="Web 演示：扫描灵感大王自身"
            >
              演示扫描
            </button>
            <button
              onClick={() => setShowDashboard(true)}
              className="px-2.5 py-1 text-[10px] rounded-btn border border-border text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors"
              title="查看深度扫描结果"
            >
              仪表盘
            </button>
            <button
              onClick={() => setShowRequirementSync(true)}
              className="px-2.5 py-1 text-[10px] rounded-btn border border-border text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors"
              title="需求同步器 - 拆解需求为子任务"
            >
              📋 需求
            </button>
            <button
              onClick={handleRescan}
              disabled={scanning}
              className="px-2.5 py-1 text-[10px] rounded-btn bg-brand hover:bg-brand-hover text-white transition-colors disabled:opacity-50"
            >
              {scanning ? '扫描中…' : '重新扫描'}
            </button>
          </div>
        </div>
      </div>
      {showDashboard && <ProjectScanDashboard onClose={() => setShowDashboard(false)} />}
      {showRequirementSync && <RequirementSyncPanel onClose={() => setShowRequirementSync(false)} />}
    </div>
  );
}
