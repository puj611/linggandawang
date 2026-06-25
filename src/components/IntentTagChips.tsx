// src/components/IntentTagChips.tsx
// 意图标签 chip 展示，可删除
import type { IntentTag } from '@/types/intent-tag';

interface Props {
  tags: IntentTag[];
  onRemove?: (id: string) => void;
}

export function IntentTagChips({ tags, onRemove }: Props) {
  if (tags.length === 0) {
    return <div className="text-[10px] text-text-tertiary">暂无意图标签，回答问题以挤出标签</div>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const isYellow = t.source_type === 'screenshot-diagnosis';
        return (
          <span
            key={t.id}
            className={`tag-chip ${isYellow ? '!bg-amber-500/10 !text-amber-400/80' : ''}`}
            title={`来自 ${t.stage} 阶段 · ${t.source_type}`}
          >
            <span>
              {t.label}: {t.value}
            </span>
            {t.deletable && onRemove && (
              <button
                onClick={() => onRemove(t.id)}
                className="ml-1 text-current opacity-50 hover:opacity-100 transition-opacity"
                aria-label="删除"
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
