// src/components/ProjectBadge.tsx
// 顶部项目胶囊：显示当前项目名+主要技术栈，点击展开项目详情面板
import { useState } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { ProjectPanel } from './ProjectPanel';
import { FRAMEWORK_LABELS, CSS_LABELS } from '@/lib/tech-rules';

export function ProjectBadge() {
  const fingerprint = useProjectStore((s) => s.fingerprint);
  const [panelOpen, setPanelOpen] = useState(false);

  if (!fingerprint || !fingerprint.path) {
    return null;
  }

  const tags: string[] = [];
  if (fingerprint.framework) tags.push(FRAMEWORK_LABELS[fingerprint.framework] ?? fingerprint.framework);
  if (fingerprint.language === 'typescript') tags.push('TypeScript');
  if (fingerprint.css_solution) tags.push(CSS_LABELS[fingerprint.css_solution] ?? fingerprint.css_solution);
  if (fingerprint.build_tool) tags.push(fingerprint.build_tool.toUpperCase());
  if (fingerprint.ui_libraries.length > 0) tags.push(fingerprint.ui_libraries[0]);

  return (
    <>
      <button
        onClick={() => setPanelOpen(true)}
        className="mx-4 mb-2 flex items-center gap-2 px-2.5 py-1.5 bg-bg-main border border-border rounded-btn hover:border-brand hover:bg-bg-card-hover transition-colors text-left group"
        title="点击查看项目详情"
      >
        <span className="w-4 h-4 flex items-center justify-center text-brand flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] text-text-primary font-medium truncate">
            {fingerprint.name}
          </span>
          <span className="block text-[9px] text-text-tertiary truncate">
            {tags.join(' · ') || '已绑定项目'}
          </span>
        </span>
        <span className="text-text-tertiary group-hover:text-text-secondary flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </button>
      {panelOpen && <ProjectPanel onClose={() => setPanelOpen(false)} />}
    </>
  );
}
