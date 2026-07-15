// src/components/StartTemplates.tsx
// 3 个起点模板按钮
import { useState } from 'react';

const TEMPLATES = [
  { id: 'fix-ui', label: '修一个看不顺眼的地方', seed: '修一个看不顺眼的地方', icon: '🔧' },
  { id: 'add-detail', label: '加一个细节', seed: '给现有功能加一个细节', icon: '✨' },
  { id: 'copy-feature', label: '复制一个产品的特性', seed: '复制一个我喜欢的产品的小特性', icon: '📋' },
];

interface Props {
  onPick: (seed: string) => void;
}

export function StartTemplates({ onPick }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div className="px-5 py-2 animate-fade-in">
      <div className="text-[10px] text-text-tertiary uppercase tracking-wider mb-2 font-medium">快速起点</div>
      <div className="flex flex-col gap-1.5">
        {TEMPLATES.map((t, i) => (
          <button
            key={t.id}
            onClick={() => onPick(t.seed)}
            onMouseEnter={() => setHovered(t.id)}
            onMouseLeave={() => setHovered(null)}
            className={`text-left px-3 py-2.5 text-xs rounded-btn border transition-all animate-slide-up ${
              hovered === t.id
                ? 'border-brand bg-brand-soft text-text-primary shadow-sm'
                : 'border-border bg-surface-2/50 text-text-secondary hover:text-text-primary hover:border-border-light hover:bg-surface-2'
            }`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
