// src/components/ExpandedCard.tsx
// 展开态：输入卡片 + 截图诊断区 + 图片提示词拆解
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useFlow } from '@/hooks/useFlow';
import { useDrag } from '@/hooks/useDrag';
import { useResize } from '@/hooks/useResize';
import { StartTemplates } from './StartTemplates';
import { RecentPromptList } from './RecentPromptList';
import { ScreenshotDropZone } from './ScreenshotDropZone';
import { DiagnosisReport, type DiagnosisIssue } from './DiagnosisReport';
import { ImageExtractResult } from './ImageExtractResult';
import { ReferenceImagePanel } from './ReferenceImagePanel';
import { screenshotDiagnoser } from '@/engine/ScreenshotDiagnoser';
import { imagePromptExtractor, type ExtractedPrompt } from '@/engine/ImagePromptExtractor';
import { useFeatureStore } from '@/stores/featureStore';
import { useWindowStore } from '@/stores/windowStore';
import { useProjectStore } from '@/stores/projectStore';
import { ProjectBadge } from './ProjectBadge';
import { ProjectOnboarding } from './ProjectOnboarding';
import { isTauri } from '@/lib/env';
import { isVisionModel } from '@/lib/llm/types';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { questionLoader } from '@/engine/QuestionLoader';
import type { ScreenshotPayload } from '@/hooks/useScreenshotPaste';
import type { FlowMode } from '@/engine/types';

interface Props {
  droppedImage: ScreenshotPayload | null;
  onImageConsumed: () => void;
}

// P3 模式记忆：localStorage 持久化用户选择的提问模式
const MODE_STORAGE_KEY = 'linggan_flow_mode';

function loadStoredMode(): FlowMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    if (v === 'direct' || v === 'quick' || v === 'full') return v;
  } catch {
    // localStorage 不可用时静默降级
  }
  return 'full';
}

function saveStoredMode(m: FlowMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, m);
  } catch {
    // 静默降级
  }
}

export function ExpandedCard({ droppedImage, onImageConsumed }: Props) {
  const [input, setInput] = useState('');
  // P3 模式记忆：初始值从 localStorage 读取
  const [mode, setMode] = useState<FlowMode>(loadStoredMode);
  const [issues, setIssues] = useState<DiagnosisIssue[] | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [extractResult, setExtractResult] = useState<ExtractedPrompt | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [screenshotData, setScreenshotData] = useState<ScreenshotPayload | null>(null);

  // P1 文案动态化：从问题库计算当前场景的 quick 题数，避免硬编码"7 道"
  const quickCount = useMemo(() => {
    try {
      const bank = questionLoader.getBank();
      return bank.questions.filter((q) => q.quick_mode).length;
    } catch {
      return 7; // 加载失败时降级为旧文案
    }
  }, []);

  // P3 模式记忆：mode 变化时持久化
  const handleModeChange = (m: FlowMode) => {
    setMode(m);
    saveStoredMode(m);
  };
  const collapse = useAppStore((s) => s.collapse);
  const transition = useAppStore((s) => s.transition);
  const openSettings = useAppStore((s) => s.openSettings);
  const { start, directGenerate, addScreenshotTags } = useFlow();
  // v2.3：逐个 selector 精准订阅 feature 字段，避免整 store 订阅
  const screenshotDiagnosis = useFeatureStore((s) => s.screenshotDiagnosis);
  const screenshotAdvanced = useFeatureStore((s) => s.screenshotAdvanced);
  const alwaysOnTop = useWindowStore((s) => s.alwaysOnTop);
  const toggleAlwaysOnTop = useWindowStore((s) => s.toggleAlwaysOnTop);
  const { dragProps, offset } = useDrag();
  const { resizeProps, width } = useResize();
  const projectPath = useProjectStore((s) => s.fingerprint?.path);
  // P3-9：视觉模型检查 —— 模型不支持视觉时禁用图片拆解按钮
  const llmConfig = useApiKeyStore((s) => s.config);
  const hasApiKey = useApiKeyStore((s) => s.hasApiKey);
  const visionSupported = !!(llmConfig && llmConfig.model && isVisionModel(llmConfig.model));

  // v2.3：组件挂载状态引用，async 操作 await 后检查，避免卸载后 setState
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!droppedImage) return;
    (async () => {
      if (!screenshotDiagnosis) {
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
          advancedEnabled: screenshotAdvanced,
        });
        if (!mountedRef.current) return;
        setIssues(result);
      } catch (e) {
        console.error('[ExpandedCard] 拖入图片诊断失败', e);
      } finally {
        if (mountedRef.current) setDiagnosing(false);
        onImageConsumed();
      }
    })();
  }, [droppedImage, screenshotDiagnosis, screenshotAdvanced, onImageConsumed]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (mode === 'direct') {
      directGenerate(input.trim());
    } else {
      void start(input.trim(), mode);
    }
  };

  const onTemplate = (text: string) => {
    if (mode === 'direct') {
      void directGenerate(text);
    } else {
      void start(text, mode);
    }
  };

  const onScreenshot = async (p: ScreenshotPayload) => {
    if (!screenshotDiagnosis) return;
    setScreenshotData(p);
    setDiagnosing(true);
    setIssues(null);
    setExtractResult(null);
    try {
      const result = await screenshotDiagnoser.diagnose({
        dataUrl: p.dataUrl,
        width: p.width,
        height: p.height,
        advancedEnabled: screenshotAdvanced,
      });
      if (!mountedRef.current) return;
      setIssues(result);
    } finally {
      if (mountedRef.current) setDiagnosing(false);
    }
  };

  const onExtractPrompt = async () => {
    if (!screenshotData) return;
    // P3-9：未配置 LLM / 未填写 Key / 模型不支持视觉，直接拦截
    if (!llmConfig || !hasApiKey || !visionSupported) return;
    setExtracting(true);
    setExtractResult(null);
    try {
      const result = await imagePromptExtractor.extract({
        dataUrl: screenshotData.dataUrl,
      });
      if (!mountedRef.current) return;
      setExtractResult(result);
    } catch (e) {
      console.error('[ExpandedCard] 图片拆解失败', e);
    } finally {
      if (mountedRef.current) setExtracting(false);
    }
  };

  const onInsertExtractedPrompt = (prompt: string) => {
    setInput(prompt);
    setExtractResult(null);
  };

  const onInsertIssues = async (tags: Parameters<typeof addScreenshotTags>[0]) => {
    await addScreenshotTags(tags);
    if (useAppStore.getState().state === 'expanded') {
      void start('截图诊断已加入标签，继续提问');
    } else {
      transition('question');
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 9999 }}
    >
      <div
        className="window-panel flex flex-col overflow-hidden relative"
        style={{
          width: `${width}px`,
          maxHeight: '85vh',
          minHeight: '480px',
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      >
      {/* 顶部标题栏：拖动把手 */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border select-none shrink-0"
        {...dragProps}
      >
        <div className="flex items-center gap-3 text-text-tertiary">
          <span className="text-xs font-medium tracking-wide">灵感大王</span>
          {/* 模式徽章：点击跳转设置；基础模式用中性色，智能模式用品牌色 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              openSettings();
            }}
            title={hasApiKey ? '智能模式（已配置 LLM）- 点击设置' : '基础模式（未配置 LLM）- 点击配置 LLM 获得智能增强'}
            className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors no-drag ${
              hasApiKey
                ? 'bg-brand-soft text-brand border-brand/30 hover:bg-brand/15'
                : 'bg-surface-2 text-text-tertiary border-border hover:bg-surface-3 hover:text-text-secondary'
            }`}
          >
            {hasApiKey ? '✨ 智能模式' : '⚙ 基础模式'}
          </button>
        </div>
        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={toggleAlwaysOnTop}
            title={alwaysOnTop ? '取消置顶' : '窗口置顶'}
            className={`p-2 rounded-btn transition-all ${
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
            className="p-2 rounded-btn text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all"
            aria-label="设置"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {isTauri() && (
          <button
            onClick={collapse}
            className="p-2 rounded-btn text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-all"
            aria-label="收起"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          )}
        </div>
      </div>

      {/* 内容区：可滚动 */}
      <div className="flex-1 overflow-y-auto">
        {/* 输入区 */}
        <form onSubmit={onSubmit} className="p-4 pb-3">
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="比如：我想让按钮更显眼 / 列表太挤了 / 想加个登录页"
            rows={3}
            maxLength={2000}
            className="w-full bg-surface-2 border border-border rounded-btn px-4 py-3 text-sm text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:border-brand transition-colors leading-relaxed"
          />
          {/* 模式选择 */}
          <div className="flex gap-1 mt-2 bg-surface-2 rounded-btn p-1">
            {([
              { value: 'direct', label: '直接生成', hint: '不提问，直接基于描述生成提示词' },
              { value: 'quick', label: '快速提问', hint: `约 ${quickCount} 道核心题，快速出结果` },
              { value: 'full', label: '详细诊断', hint: '完整 31 道题，深度诊断' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleModeChange(opt.value)}
                title={opt.hint}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-all ${
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
            <span className="text-xs text-text-tertiary">
              {input.length > 0 ? `${input.length} 个字符` : '按 Enter 开始提问'}
            </span>
            <button
              type="submit"
              disabled={!input.trim()}
              className="primary-btn px-4 py-2 text-xs"
            >
              {mode === 'direct' ? '直接生成 →' : '开始提问 →'}
            </button>
          </div>
        </form>

        {/* 项目感知 */}
        <div className="px-4 pb-3">
          {projectPath ? <ProjectBadge /> : <ProjectOnboarding />}
        </div>

        {/* 截图诊断区 */}
        <div className="px-4 pb-3">
          <ScreenshotDropZone onScreenshot={onScreenshot} />
          {diagnosing && (
            <div className="flex items-center gap-2 text-xs text-text-tertiary mt-2">
              <div className="w-3 h-3 border border-brand border-t-transparent rounded-full animate-spin" />
              <span>正在分析截图…</span>
            </div>
          )}
          {issues && <DiagnosisReport issues={issues} onInsertToSpec={onInsertIssues} />}

          {/* 图片提示词拆解按钮 */}
          {screenshotData && !diagnosing && (
            <div className="mt-2">
              <button
                onClick={onExtractPrompt}
                disabled={extracting || !visionSupported || !hasApiKey}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs border border-dashed rounded-btn transition-colors ${
                  visionSupported && hasApiKey
                    ? 'border-border hover:border-brand hover:bg-brand/5 text-text-secondary'
                    : 'border-border text-text-tertiary cursor-not-allowed opacity-60'
                }`}
              >
                {extracting ? (
                  <>
                    <div className="w-3 h-3 border border-brand border-t-transparent rounded-full animate-spin" />
                    <span>正在拆解提示词…</span>
                  </>
                ) : !llmConfig || !hasApiKey ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span>拆解图片提示词（高级功能，需配置 LLM）</span>
                  </>
                ) : !visionSupported ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span>当前模型（{llmConfig.model}）不支持视觉输入，请配置视觉模型（如 gpt-4o、qwen-vl-plus）</span>
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span>拆解图片提示词（需要配置视觉模型）</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* 拆解结果 */}
          {extractResult && (
            <ImageExtractResult
              result={extractResult}
              onInsert={onInsertExtractedPrompt}
              onClose={() => setExtractResult(null)}
            />
          )}

          <ReferenceImagePanel />
        </div>

        {/* 起点模板 */}
        <StartTemplates onPick={onTemplate} />

        {/* 最近提示词 */}
        <RecentPromptList />
      </div>

      {/* P1.5：右下角宽度调整把手 */}
      <div
        {...resizeProps}
        data-no-drag
        className="absolute right-0 bottom-0 w-3 h-10 flex items-center justify-center hover:bg-surface-3/50 transition-colors group rounded-br-card"
        title="拖动调整宽度"
      >
        <div className="w-0.5 h-4 bg-border-light rounded-full group-hover:bg-brand transition-colors" />
      </div>
      </div>
    </div>
  );
}
