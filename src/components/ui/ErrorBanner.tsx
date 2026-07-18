// src/components/ui/ErrorBanner.tsx
// 通用错误提示条：inline 形式展示错误信息，可关闭
import { useState, useEffect } from 'react';

interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  variant?: 'error' | 'warning' | 'success' | 'info';
  className?: string;
  persist?: boolean;
}

const VARIANT_STYLES = {
  error: 'bg-semantic-error/10 border-semantic-error/30 text-semantic-error',
  warning: 'bg-semantic-warning/10 border-semantic-warning/30 text-semantic-warning',
  success: 'bg-semantic-success/10 border-semantic-success/30 text-semantic-success',
  info: 'bg-brand-soft border-brand/30 text-brand',
};

export function ErrorBanner({
  message,
  onDismiss,
  variant = 'error',
  className = '',
  persist = false,
}: ErrorBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // message 变化时重置 dismissed，确保新错误能正常显示
  useEffect(() => {
    setDismissed(false);
  }, [message]);

  if (!message || (!persist && dismissed)) return null;

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-btn border text-[11px] animate-slide-down ${VARIANT_STYLES[variant]} ${className}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
    >
      <span className="flex-1 leading-relaxed break-words">{message}</span>
      {!persist && (
        <button
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
          className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-1"
          aria-label="关闭提示"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
