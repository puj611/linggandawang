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
import type { ScreenshotPayload } from '@/hooks/useScreenshotPaste';

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
    })();
  }, [loadCtx, loadFeatures, loadPosition, loadAlwaysOnTop, loadAnalytics, loadProject, loadApiKeyConfig]);

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
    </div>
  );
}
