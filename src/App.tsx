// src/App.tsx
// 应用根组件
import { useEffect, useState } from 'react';
import { MainWindow } from './components/MainWindow';
import { useContextStore } from '@/stores/contextStore';
import { useFeatureStore } from '@/stores/featureStore';
import { useWindowStore } from '@/stores/windowStore';
import { questionLoader } from '@/engine/QuestionLoader';
import { loadHotkey } from '@/hooks/useHotkey';
import { useTauriDropFile } from '@/hooks/useTauriDropFile';
import { isTauri } from '@/lib/env';
import { useAnalyticsStore } from '@/stores/analyticsStore';
import { useProjectStore } from '@/stores/projectStore';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { PrivacyDialog } from '@/components/PrivacyDialog';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { getPreference, setPreference } from '@/lib/sqlite';
import type { ScreenshotPayload } from '@/hooks/useScreenshotPaste';

// 首次引导持久化键：值为 '1' 表示已看过引导
const ONBOARDING_SEEN_KEY = 'onboarding_seen';
// 跨组件事件名：SettingsPanel 派发此事件可重新唤起引导遮罩
const ONBOARDING_SHOW_EVENT = 'show-onboarding';

export default function App() {
  // 启动时加载持久化数据
  const loadCtx = useContextStore((s) => s.load);
  const loadFeatures = useFeatureStore((s) => s.load);
  const loadPosition = useWindowStore((s) => s.loadPosition);
  const loadAlwaysOnTop = useWindowStore((s) => s.loadAlwaysOnTop);
  const loadAnalytics = useAnalyticsStore((s) => s.load);
  const loadProject = useProjectStore((s) => s.load);
  const loadApiKeyConfig = useApiKeyStore((s) => s.load);
  const [droppedImage, setDroppedImage] = useState<ScreenshotPayload | null>(null);
  // 首次使用引导遮罩可见性：null=未决定，true=显示，false=隐藏
  const [onboardingVisible, setOnboardingVisible] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      await loadFeatures();
      await loadHotkey();
      await loadCtx();
      loadPosition();
      loadAlwaysOnTop();
      loadAnalytics();
      loadProject();
      loadApiKeyConfig();
      // 启动时检查上下文是否过期归档（FR-005 验收标准 3）
      await useContextStore.getState().archiveIfStale();
      try {
        await questionLoader.preloadUserBank();
        questionLoader.load();
      } catch (e) {
        console.error('[App] 问题库加载失败', e);
      }
      // 启动时检查是否已看过新手引导（P1.4）
      try {
        const seen = await getPreference<string>(ONBOARDING_SEEN_KEY, '');
        setOnboardingVisible(seen !== '1');
      } catch (e) {
        console.error('[App] 读取引导标记失败', e);
        setOnboardingVisible(false);
      }
    })();
  }, [loadCtx, loadFeatures, loadPosition, loadAlwaysOnTop, loadAnalytics, loadProject, loadApiKeyConfig]);

  // 监听 SettingsPanel 派发的"重新查看新手引导"事件
  useEffect(() => {
    const handler = () => setOnboardingVisible(true);
    window.addEventListener(ONBOARDING_SHOW_EVENT, handler);
    return () => window.removeEventListener(ONBOARDING_SHOW_EVENT, handler);
  }, []);

  // 引导完成：持久化标记并隐藏遮罩
  const onOnboardingComplete = async () => {
    setOnboardingVisible(false);
    try {
      await setPreference(ONBOARDING_SEEN_KEY, '1');
    } catch (e) {
      console.error('[App] 写入引导标记失败', e);
    }
  };

  // Tauri 全局系统拖入文件监听
  useTauriDropFile(
    async (paths) => {
      if (!isTauri()) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const path = paths[0];
        const result = await invoke<{ data_url: string; width: number; height: number }>(
          'read_image_file',
          { path },
        );
        setDroppedImage({
          dataUrl: result.data_url,
          width: result.width,
          height: result.height,
          source: 'drop',
        });
      } catch (e) {
        console.error('[App] 读取拖入图片失败', e);
      }
    },
  );

  return (
    <div className="relative w-full h-full">
      <MainWindow droppedImage={droppedImage} onImageConsumed={() => setDroppedImage(null)} />
      <PrivacyDialog />
      {/* 首次使用引导遮罩（P1.4）：仅在状态已决定且需要显示时渲染 */}
      {onboardingVisible && <OnboardingOverlay onComplete={onOnboardingComplete} />}
    </div>
  );
}
