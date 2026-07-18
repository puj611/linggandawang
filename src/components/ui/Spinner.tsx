// src/components/ui/Spinner.tsx
// 通用加载状态指示器
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-3 h-3 border',
  md: 'w-4 h-4 border-2',
  lg: 'w-6 h-6 border-2',
};

export function Spinner({ size = 'md', label, className = '' }: SpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`} role="status" aria-live="polite">
      <div
        className={`${SIZE_MAP[size]} border-brand border-t-transparent rounded-full animate-spin`}
        aria-hidden="true"
      />
      {label && <span className="text-text-secondary text-sm">{label}</span>}
    </div>
  );
}
