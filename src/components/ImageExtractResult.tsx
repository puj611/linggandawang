// src/components/ImageExtractResult.tsx
// 图片提示词拆解结果展示

import type { ExtractedPrompt } from '@/engine/ImagePromptExtractor';
import { useState } from 'react';

interface Props {
  result: ExtractedPrompt;
  onInsert: (prompt: string) => void;
  onClose: () => void;
}

export function ImageExtractResult({ result, onInsert, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [showFull, setShowFull] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.fullPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsert = () => {
    onInsert(result.fullPrompt);
  };

  return (
    <div className="mt-3 border border-border rounded-btn overflow-hidden bg-surface-1">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">图片提示词拆解</span>
        </div>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 拆解内容 */}
      <div className="p-3 space-y-2.5 text-xs">
        {/* 场景 */}
        <div>
          <span className="text-text-tertiary">场景：</span>
          <span className="text-text-secondary">{result.scene}</span>
        </div>

        {/* 主体元素 */}
        {result.subjects.length > 0 && (
          <div>
            <span className="text-text-tertiary">主体：</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {result.subjects.map((s, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-surface-3 rounded text-text-secondary">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 风格 */}
        {result.style.length > 0 && (
          <div>
            <span className="text-text-tertiary">风格：</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {result.style.map((s, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-brand-soft text-brand rounded">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 色彩 */}
        {result.colors.length > 0 && (
          <div>
            <span className="text-text-tertiary">色彩：</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {result.colors.map((c, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-surface-3 rounded text-text-secondary">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 构图 */}
        <div>
          <span className="text-text-tertiary">构图：</span>
          <span className="text-text-secondary">{result.layout}</span>
        </div>

        {/* 氛围 */}
        <div>
          <span className="text-text-tertiary">氛围：</span>
          <span className="text-text-secondary">{result.mood}</span>
        </div>

        {/* 完整提示词（可折叠） */}
        {result.fullPrompt && (
          <div className="pt-1 border-t border-border">
            <button
              onClick={() => setShowFull(!showFull)}
              className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`transition-transform ${showFull ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>完整提示词（英文）</span>
            </button>
            {showFull && (
              <div className="mt-2 p-2 bg-surface-2 rounded text-text-secondary font-mono text-[11px] leading-relaxed break-all">
                {result.fullPrompt}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2 px-3 py-2 border-t border-border bg-surface-2">
        <button
          onClick={handleCopy}
          className="flex-1 px-3 py-1.5 text-xs border border-border rounded-btn hover:bg-surface-3 transition-colors text-text-secondary"
        >
          {copied ? '已复制 ✓' : '复制提示词'}
        </button>
        <button
          onClick={handleInsert}
          className="flex-1 px-3 py-1.5 text-xs primary-btn rounded-btn"
        >
          插入到输入框
        </button>
      </div>
    </div>
  );
}
