// src/components/ui/EmptyState.tsx
// 通用空状态展示：当数据为空或没有结果时统一展示
interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title = '暂无内容',
  description,
  action,
  icon,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-8 px-4 text-center ${className}`}>
      {icon && <div className="mb-3 text-text-tertiary">{icon}</div>}
      <div className="text-text-secondary text-sm font-medium mb-1">{title}</div>
      {description && (
        <div className="text-text-tertiary text-xs max-w-[240px] leading-relaxed">{description}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
