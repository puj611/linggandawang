// src/hooks/useTauriDropFile.ts
// Tauri 桌面端全局监听系统拖入文件（图片/PDF/文本等）
// 当用户从资源管理器拖一张图片到悬浮窗时也会触发。
// 浏览器环境：降级为 no-op（浏览器走 HTML5 drag-drop）。
import { useEffect } from 'react';
import { isTauri } from '@/lib/env';

export interface TauriDropPayload {
  paths: string[];
  type: 'drop' | 'over' | 'leave';
}

export function useTauriDropFile(
  onDrop: (paths: string[]) => void,
  onHoverChange?: (hover: boolean) => void,
) {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent((event) => {
          if (event.payload.type === 'over') {
            onHoverChange?.(true);
          } else if (event.payload.type === 'leave') {
            onHoverChange?.(false);
          } else if (event.payload.type === 'drop') {
            onHoverChange?.(false);
            // P2-6 修复：用类型守卫替代不安全的 as 断言，兼容 payload 结构变更
            const payload = event.payload as unknown;
            const paths: string[] =
              payload && typeof payload === 'object' && 'paths' in payload
                ? Array.isArray((payload as { paths?: unknown }).paths)
                  ? ((payload as { paths: unknown[] }).paths.filter((p): p is string => typeof p === 'string'))
                  : []
                : [];
            // P2-2 安全：移除 svg 支持
            const imagePaths = paths.filter((p) =>
              /\.(png|jpe?g|gif|webp|bmp)$/i.test(p),
            );
            if (imagePaths.length > 0) {
              onDrop(imagePaths);
            }
          }
        });
      } catch (e) {
        console.warn('[useTauriDropFile] init failed', e);
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [onDrop, onHoverChange]);
}
