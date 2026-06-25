// src/components/ReferenceImagePanel.tsx
// P1.3：参照图/情绪板面板
// 紧凑的可折叠面板：拖入 / 粘贴 / 选择图片，最多 3 张；每张配备注；可"添加到提示词"转化为意图标签
import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useFlow } from '@/hooks/useFlow';
import { useAppStore } from '@/stores/appStore';
import type { IntentTag } from '@/types/intent-tag';

interface ReferenceImage {
  id: string;
  dataUrl: string;
  note: string;
}

const MAX_IMAGES = 3;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ReferenceImagePanel() {
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { addScreenshotTags, start } = useFlow();
  const transition = useAppStore((s) => s.transition);

  // 添加一张图片文件（最多 MAX_IMAGES 张，多余会被忽略）
  const addImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (images.length >= MAX_IMAGES) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setImages((cur) =>
        cur.length >= MAX_IMAGES
          ? cur
          : [...cur, { id: uuidv4(), dataUrl, note: '' }],
      );
    } catch (e) {
      console.warn('[ReferenceImagePanel] 读取图片失败', e);
    }
  }, [images.length]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void addImageFile(file);
    },
    [addImageFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  // 容器聚焦时支持 Ctrl+V 粘贴图片（不污染全局 paste，避免与截图诊断区冲突）
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          void addImageFile(file);
          break;
        }
      }
    },
    [addImageFile],
  );

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void addImageFile(file);
    e.target.value = '';
  };

  const onNoteChange = (id: string, note: string) => {
    setImages((cur) => cur.map((img) => (img.id === id ? { ...img, note } : img)));
  };

  const onRemove = (id: string) => {
    setImages((cur) => cur.filter((img) => img.id !== id));
  };

  // 把有备注的图转为意图标签，并触发后续流程
  const onAddToPrompt = async () => {
    const usable = images.filter((img) => img.note.trim().length > 0);
    if (usable.length === 0) return;
    const tags: IntentTag[] = usable.map((img) => ({
      id: uuidv4(),
      label: '参照图',
      value: img.note.trim(),
      stage: 'spec',
      source_question_id: `reference-image-${img.id}`,
      // 复用现有枚举值，避免引入新类型；视觉上 chips 会以黄色高亮
      source_type: 'screenshot-diagnosis',
      confidence: 1,
      deletable: true,
      created_at: new Date().toISOString(),
    }));
    await addScreenshotTags(tags);
    setAddedFlash(true);
    setTimeout(() => setAddedFlash(false), 1500);
    const state = useAppStore.getState().state;
    if (state === 'expanded') {
      start('参照图已加入标签，继续提问');
    } else if (state === 'result') {
      // addScreenshotTags 内部已重生成 prompt，无需额外动作
    } else if (state === 'question') {
      // 提问态：标签已加入，继续回答下一题
    } else {
      transition('question');
    }
  };

  const headerCount = `${images.length}/${MAX_IMAGES}`;
  const hasNotes = images.some((i) => i.note.trim().length > 0);

  return (
    <div
      className={`mt-2 border border-border rounded-btn overflow-hidden transition-colors ${
        dragging ? 'border-brand bg-brand/5' : 'bg-surface-2'
      }`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onPaste={onPaste}
      tabIndex={0}
    >
      {/* 折叠头部 */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          参照图 / 情绪板
          <span className="text-[10px] text-text-tertiary">（{headerCount}）</span>
        </span>
        <span className="text-text-tertiary text-[10px]">
          {collapsed ? '展开 ▾' : '收起 ▴'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {images.length === 0 ? (
            <div
              className="border border-dashed border-border rounded-btn px-3 py-3 text-center text-[11px] text-text-tertiary cursor-pointer hover:border-brand hover:text-text-secondary transition-colors"
              onClick={() => fileInputRef.current?.click()}
              role="button"
            >
              拖入 / 粘贴 / 点击添加参照图（最多 {MAX_IMAGES} 张）
            </div>
          ) : (
            <div className="space-y-2">
              {images.map((img) => (
                <div key={img.id} className="flex gap-2 items-start">
                  <img
                    src={img.dataUrl}
                    alt="参照图"
                    className="w-12 h-12 rounded-btn object-cover border border-border flex-shrink-0"
                  />
                  <input
                    value={img.note}
                    onChange={(e) => onNoteChange(img.id, e.target.value)}
                    placeholder="备注：如 Apple 官网极简风"
                    className="flex-1 bg-surface-1 border border-border rounded-btn px-2 py-1.5 text-[11px] text-text-primary placeholder-text-tertiary focus:outline-none focus:border-brand transition-colors min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => onRemove(img.id)}
                    className="text-text-tertiary hover:text-text-primary px-1 py-1"
                    aria-label="移除参照图"
                    title="移除"
                  >
                    ×
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full text-[11px] text-text-secondary hover:text-text-primary border border-dashed border-border rounded-btn py-1.5 transition-colors"
                >
                  + 添加一张
                </button>
              )}
            </div>
          )}

          {/* 操作行 */}
          {images.length > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-text-tertiary">
                {images.filter((i) => i.note.trim()).length} 张已写备注
              </span>
              <button
                type="button"
                onClick={onAddToPrompt}
                disabled={!hasNotes}
                className={`px-2.5 py-1 text-[11px] rounded-btn transition-colors ${
                  addedFlash
                    ? 'bg-semantic-success text-white'
                    : !hasNotes
                      ? 'border border-border text-text-tertiary cursor-not-allowed'
                      : 'bg-brand text-white hover:bg-brand-strong'
                }`}
              >
                {addedFlash ? '已加入 ✓' : '添加到提示词'}
              </button>
            </div>
          )}

          {/* 隐藏的文件选择 input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFilePick}
          />
        </div>
      )}
    </div>
  );
}
