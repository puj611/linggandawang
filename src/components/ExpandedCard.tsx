// src/components/ExpandedCard.tsx
// 展开态：输入卡片 + 截图诊断区
import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useFlow } from '@/hooks/useFlow';
import { useDrag } from '@/hooks/useDrag';
import { useResize } from '@/hooks/useResize';
import { StartTemplates } from './StartTemplates';
import { RecentPromptList } from './RecentPromptList';
import { ScreenshotDropZone } from './ScreenshotDropZone';
import { DiagnosisReport, type DiagnosisIssue } from './DiagnosisReport';
import { ReferenceImagePanel } from './ReferenceImagePanel';
import { screenshotDiagnoser } from '@/engine/ScreenshotDiagnoser';
import { useFeatureStore } from '@/stores/featureStore';
import { useWindowStore } from '@/stores/windowStore';
import { useProjectStore } from '@/stores/projectStore';
import { ProjectBadge } from './ProjectBadge';
import { ProjectOnboarding } from './ProjectOnboarding';
import type { ScreenshotPayload } from '@/hooks/useScreenshotPaste';
import type { FlowMode } from '@/engine/types';

interface Props {
  droppedImage: ScreenshotPayload | null;
  onImageConsumed: () => void;
}

export function ExpandedCard({ droppedImage, onImageConsumed }: Props) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<FlowMode>('full');
  const [issues, setIssues] = useState<DiagnosisIssue[] | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const transition = useAppStore((s) => s.transition);
  const collapse = useAppStore((s) => s.collapse);
  const openSettings = useAppStore((s) => s.openSettings);
  const { start, directGenerate, addScreenshotTags } = useFlow();
  const features = useFeatureStore();
  const alwaysOnTop = useWindowStore((s) => s.alwaysOnTop);
  const toggleAlwaysOnTop = useWindowStore((s) => s.toggleAlwaysOnTop);
  const { dragProps, offset } = useDrag();
  // P1.5：右下角宽度调整把手
  const { resizeProps, width } = useResize();
  const projectPath = useProjectStore((s) => s.fingerprint?.path);

  useEffect(() => {
    if (!droppedImage) return;
    (async () => {
      if (!features.screenshotDiagnosis) {
        onImageConsumed();
        return;
      }
      setDiagnosing(true);
      setIssues(null);
      try {
        const result = await screenshotDiagnoser.diagnose({
          dataUrl: droppedImage.dataUrl,
          width: droppedImage.width,
          height: droppedImage.height,
          advancedEnabled: features.screenshotAdvanced,
        });
        setIssues(result);
      } catch (e) {
        console.error('[ExpandedCard] 拖入图片诊断失败', e);
      } finally {
        setDiagnosing(false);
        onImageConsumed();
      }
    })();
  }, [droppedImage, features.screenshotDiagnosis, features.screenshotAdvanced, onImageConsumed]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (mode === 'direct') {
      directGenerate(input.trim());
    } else {
      start(input.trim(), mode);
    }
  };

  const onTemplate = (text: string) => {
    if (mode === 'direct') {
      directGenerate(text);
    } else {
      start(text, mode);
    }
  };

  const onScreenshot = async (p: ScreenshotPayload) => {
    if (!features.screenshotDiagnosis) return;
    setDiagnosing(true);
    setIssues(null);
    try {
      const result = await screenshotDiagnoser.diagnose({
        dataUrl: p.dataUrl,
        width: p.width,
        height: p.height,
        advancedEnabled: features.screenshotAdvanced,
      });
      setIssues(result);
    } finally {
      setDiagnosing(false);
    }
  };

  const onInsertIssues = async (tags: Parameters<typeof addScreenshotTags>[0]) => {
    await addScreenshotTags(tags);
    if (useAppStore.getState().state === 'expanded') {
      start('截图诊断已加入标签，继续提问');
    } else {
      transition('question');
    }
  };

  return (
    <div
      className="fixed left-1/2 top-1/2 max-h-[580px] bg-transparent flex flex-col items-center overflow-visible"
      style={{
        zIndex: 9999,
        width: `${width}px`,
        transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
      }}
    >
      <div
        className="relative w-full max-h-[580px] bg-surface-1 border border-border rounded-card shadow-card flex flex-col overflow-hidden"
      >
      {/* 顶部标题栏：拖动把手 */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-border select-none"
        {...dragProps}
      >
        <div className="flex items-center gap-2 text-text-tertiary">
          <div className="flex gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-surface-3" />
            <div className="w-2.5 h-2.5 rounded-full bg-surface-3" />
            <div className="w-2.5 h-2.5 rounded-full bg-surface-3" />
          </div>
          <span className="text-[11px] font-medium tracking-wide">灵感大王</span>
        </div>
        <div className="flex items-center gap-0.5 no-drag">
          <button
            onClick={toggleAlwaysOnTop}
            title={alwaysOnTop ? '取消置顶' : '窗口置顶'}
            className={`p-1.5 rounded-btn transition-all ${
              alwaysOnTop
                ? 'text-brand bg-brand-soft'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-2'
            }`}
            aria-label="置顶切换"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="17" x2="12" y2="3" />
              <path d="M5 10l7-7 7 7" />
              <path d="M19 21H5" />
            </svg>
          </button>
          <button
            onClick={openSettings}
            className="p-1.5 rounded-btn text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all"
            aria-label="设置"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            onClick={collapse}
            className="p-1.5 rounded-btn text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all"
            aria-label="收起"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 输入区 */}
      <form onSubmit={onSubmit} className="p-5 pb-3">
        <textarea
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="比如：我想让按钮更显眼 / 列表太挤了 / 想加个登录页"
          rows={3}
          className="w-full bg-surface-2 border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:border-brand transition-colors leading-relaxed"
        />
        {/* 模式选择：直接生成 / 快速提问 / 详细诊断 */}
        <div className="flex gap-0.5 mt-2 bg-surface-2 rounded-btn p-0.5">
          {([
            { value: 'direct', label: '直接生成', hint: '不提问，直接基于描述生成提示词' },
            { value: 'quick', label: '快速提问', hint: '仅 7 道核心题，快速出结果' },
            { value: 'full', label: '详细诊断', hint: '完整 31 道题，深度诊断' },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              title={opt.hint}
              className={`flex-1 px-2 py-1 text-[10px] rounded-[6px] transition-all ${
                mode === opt.value
                  ? 'bg-surface-1 text-text-primary shadow-sm font-medium'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex justify-between items-center mt-3">
          <span className="text-[10px] text-text-tertiary">
            {input.length > 0 ? `${input.length} 个字符` : '按 Enter 开始提问'}
          </span>
          <button
            type="submit"
            disabled={!input.trim()}
            className="primary-btn px-4 py-1.5 text-xs"
          >
            {mode === 'direct' ? '直接生成 →' : '开始提问 →'}
          </button>
        </div>
      </form>

      {/* 项目感知：绑定后显示项目胶囊，未绑定显示引导 */}
      {projectPath ? <ProjectBadge /> : <ProjectOnboarding />}

      {/* 截图诊断区 */}
      <div className="px-5 pb-3">
        <ScreenshotDropZone onScreenshot={onScreenshot} />
        {diagnosing && (
          <div className="flex items-center gap-2 text-[10px] text-text-tertiary mt-2">
            <div className="w-3 h-3 border border-brand border-t-transparent rounded-full animate-spin" />
            <span>正在分析截图…</span>
          </div>
        )}
        {issues && <DiagnosisReport issues={issues} onInsertToSpec={onInsertIssues} />}
        {/* P1.3：参照图 / 情绪板（独立于截图诊断，不影响现有逻辑） */}
        <ReferenceImagePanel />
      </div>

      {/* 起点模板 */}
      <StartTemplates onPick={onTemplate} />

      {/* 最近提示词 */}
      <RecentPromptList />

      {/* P1.5：右下角宽度调整把手 */}
      <div
        {...resizeProps}
        data-no-drag
        className="absolute right-0 bottom-0 w-3 h-10 flex items-center justify-center hover:bg-surface-3/50 transition-colors group"
        title="拖动调整宽度"
      >
        <div className="w-0.5 h-4 bg-border-light rounded-full group-hover:bg-brand transition-colors" />
      </div>
      </div>
    </div>
  );
}
