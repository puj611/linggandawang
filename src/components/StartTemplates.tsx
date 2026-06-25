// src/components/StartTemplates.tsx
// 3 个起点模板按钮
import { useState } from 'react';

const TEMPLATES = [
  { id: 'fix-ui', label: '修一个看不顺眼的地方', seed: '修一个看不顺眼的地方' },
  { id: 'add-detail', label: '加一个细节', seed: '给现有功能加一个细节' },
  { id: 'copy-feature', label: '复制一个产品的特性', seed: '复制一个我喜欢的产品的小特性' },
];

interface Props {
  onPick: (seed: string) => void;
}

export function StartTemplates({ onPick }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div className="px-5 py-2">
      <div className="text-[10px] text-text-tertiary uppercase tracking-wider mb-2 font-medium">快速起点</div>
      <div className="flex flex-col gap-1.5">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t.seed)}
            onMouseEnter={() => setHovered(t.id)}
            onMouseLeave={() => setHovered(null)}
            className={`text-left px-3 py-2 text-xs rounded-btn border transition-all ${
              hovered === t.id
                ? 'border-brand bg-brand-soft text-text-primary'
                : 'border-border bg-surface-2/50 text-text-secondary hover:text-text-primary hover:border-border-light hover:bg-surface-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
