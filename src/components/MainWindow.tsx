// src/components/MainWindow.tsx
// 主窗口容器：根据 appStore.state 切换四态
import { useAppStore } from '@/stores/appStore';
import { Ball } from './Ball';
import { ExpandedCard } from './ExpandedCard';
import { QuestionPanel } from './QuestionPanel';
import { ResultPanel } from './ResultPanel';
import { SettingsPanel } from './SettingsPanel';
import { useEscKey } from '@/hooks/useHotkey';
import type { ScreenshotPayload } from '@/hooks/useScreenshotPaste';

interface MainWindowProps {
  droppedImage: ScreenshotPayload | null;
  onImageConsumed: () => void;
}

export function MainWindow({ droppedImage, onImageConsumed }: MainWindowProps) {
  const state = useAppStore((s) => s.state);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const collapse = useAppStore((s) => s.collapse);

  // ESC 任意状态回收起态
  useEscKey(collapse);

  return (
    <>
      {state === 'ball' && <Ball />}
      {state === 'expanded' && (
        <ExpandedCard droppedImage={droppedImage} onImageConsumed={onImageConsumed} />
      )}
      {state === 'question' && <QuestionPanel />}
      {state === 'result' && <ResultPanel />}
      {settingsOpen && <SettingsPanel />}
    </>
  );
}
