// src/hooks/useScreenshotPaste.ts
// 截图粘贴 / 拖入 hook
// 浏览器 clipboard + drag-drop API，无 Rust 依赖
import { useCallback, useEffect, useState } from 'react';

export interface ScreenshotPayload {
  dataUrl: string;
  width: number;
  height: number;
  source: 'paste' | 'drop';
}

export function useScreenshotPaste(
  enabled: boolean,
  onScreenshot: (payload: ScreenshotPayload) => void,
) {
  const [isDragging, setIsDragging] = useState(false);

  // Ctrl+V 粘贴
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              onScreenshot({
                dataUrl: reader.result as string,
                width: img.naturalWidth,
                height: img.naturalHeight,
                source: 'paste',
              });
            };
            img.src = reader.result as string;
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [enabled, onScreenshot]);

  // 拖入
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!enabled) return;
      const file = e.dataTransfer.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          onScreenshot({
            dataUrl: reader.result as string,
            width: img.naturalWidth,
            height: img.naturalHeight,
            source: 'drop',
          });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    },
    [enabled, onScreenshot],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      setIsDragging(true);
    },
    [enabled],
  );

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  return { isDragging, onDrop, onDragOver, onDragLeave };
}
