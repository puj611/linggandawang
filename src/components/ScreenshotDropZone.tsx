// src/components/ScreenshotDropZone.tsx
// 截图拖入/粘贴区
import { useFeatureStore } from '@/stores/featureStore';
import { useScreenshotPaste, type ScreenshotPayload } from '@/hooks/useScreenshotPaste';
import { useState } from 'react';

interface Props {
  onScreenshot: (p: ScreenshotPayload) => void;
}

export function ScreenshotDropZone({ onScreenshot }: Props) {
  // v2.3：逐个 selector 精准订阅
  const screenshotDiagnosis = useFeatureStore((s) => s.screenshotDiagnosis);
  const [preview, setPreview] = useState<string | null>(null);

  const handleScreenshot = (p: ScreenshotPayload) => {
    setPreview(p.dataUrl);
    onScreenshot(p);
  };

  const { isDragging, onDrop, onDragOver, onDragLeave } = useScreenshotPaste(
    screenshotDiagnosis,
    handleScreenshot,
  );

  if (!screenshotDiagnosis) {
    // DOWNGRADE: 截图诊断运行时开关关闭时置灰
    return (
      <div className="border border-dashed border-border rounded-btn p-3 text-center opacity-50">
        <div className="text-xs text-text-secondary">
          截图诊断功能升级中，请用文字描述视觉问题
        </div>
      </div>
    );
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`border-2 border-dashed rounded-btn p-3 text-center transition-colors ${
        isDragging ? 'border-brand bg-brand/10' : 'border-border'
      }`}
    >
      {preview ? (
        <div>
          <img
            src={preview}
            alt="截图预览"
            className="max-w-full max-h-32 mx-auto rounded"
          />
          <div className="text-[10px] text-text-secondary mt-1">
            已加载截图，正在诊断…
          </div>
        </div>
      ) : (
        <div className="text-xs text-text-secondary">
          粘贴截图（Ctrl+V）或拖入图片文件
        </div>
      )}
    </div>
  );
}
