// src/components/RawQuotesPanel.tsx
// 用户原话折叠面板，默认收起

interface Props {
  quotes: string[];
  open: boolean;
  onToggle: () => void;
}

export function RawQuotesPanel({ quotes, open, onToggle }: Props) {
  if (quotes.length === 0) return null;
  return (
    <div className="mt-4 border border-border rounded-btn overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-main text-text-secondary hover:text-text-primary transition-colors"
      >
        <span className="text-[11px]">用户原话对照（{quotes.length} 条）</span>
        <span className="text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 py-2 space-y-1 bg-bg-main/50">
          {quotes.map((q, i) => (
            <div key={i} className="text-[11px] text-text-secondary italic">
              “{q}”
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
