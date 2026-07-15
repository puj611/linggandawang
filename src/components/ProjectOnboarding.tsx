// src/components/ProjectOnboarding.tsx
// 首次使用引导：未绑定项目时显示，引导用户绑定以获得项目感知能力
import { useState } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { pickProjectFolder, scanProject } from '@/lib/projectScanner';

export function ProjectOnboarding() {
  const scanning = useProjectStore((s) => s.scanning);
  const setFingerprint = useProjectStore((s) => s.setFingerprint);
  const setScanning = useProjectStore((s) => s.setScanning);
  const setError = useProjectStore((s) => s.setError);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handlePick = async () => {
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
      setError(e instanceof Error ? e.message : '选择失败');
    } finally {
      setScanning(false);
    }
  };

  const handleDemo = async () => {
    setScanning(true);
    setError(null);
    try {
      const fp = await scanProject('');
      await setFingerprint(fp);
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="mx-5 mb-3 px-3 py-2.5 bg-brand-soft-light border border-brand/20 rounded-btn flex items-start gap-2.5 animate-slide-up">
      <span className="text-brand flex-shrink-0 mt-0.5 animate-pulse-soft">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-text-primary font-medium">绑定你的项目</div>
        <div className="text-[10px] text-text-secondary mt-0.5 leading-relaxed">
          让提示词懂你的技术栈、目录约定和代码风格，比通用优化器精准一个量级。
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handlePick}
            disabled={scanning}
            className="px-2.5 py-1 text-[10px] rounded-btn bg-brand-soft text-brand hover:bg-brand/20 transition-colors disabled:opacity-50 font-medium"
          >
            {scanning ? '扫描中…' : '选择项目文件夹'}
          </button>
          <button
            onClick={handleDemo}
            disabled={scanning}
            className="px-2.5 py-1 text-[10px] rounded-btn text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-50"
          >
            先看看演示
          </button>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-text-tertiary hover:text-text-secondary flex-shrink-0 p-0.5 transition-colors"
        aria-label="暂时关闭"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
