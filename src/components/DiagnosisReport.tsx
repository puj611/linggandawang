// src/components/DiagnosisReport.tsx
// 截图诊断报告：展示问题清单 + 一键插入规格段按钮
import type { PromptStage } from '@/engine/types';
import type { IntentTag } from '@/types/intent-tag';
import { v4 as uuidv4 } from 'uuid';

export interface DiagnosisIssue {
  type: 'contrast' | 'alignment' | 'spacing' | 'fontsize' | 'fallback';
  severity: 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
}

interface Props {
  issues: DiagnosisIssue[];
  onInsertToSpec: (tags: IntentTag[]) => void;
}

const ISSUE_TYPE_LABEL: Record<DiagnosisIssue['type'], string> = {
  contrast: '对比度不足',
  alignment: '对齐错位',
  spacing: '间距不统一',
  fontsize: '字号层级缺失',
  fallback: '视觉问题（兜底）',
};

export function DiagnosisReport({ issues, onInsertToSpec }: Props) {
  if (issues.length === 0) {
    return (
      <div className="text-[11px] text-text-secondary p-2">
        未发现明显视觉问题
      </div>
    );
  }

  const onInsertAll = () => {
    const tags: IntentTag[] = issues.map((iss) => ({
      id: uuidv4(),
      label: '视觉问题',
      value: `${ISSUE_TYPE_LABEL[iss.type]}：${iss.suggestion}`,
      stage: 'spec' as PromptStage,
      source_question_id: 'screenshot',
      source_type: 'screenshot-diagnosis',
      confidence: iss.severity === 'high' ? 0.9 : 0.7,
      deletable: true,
      created_at: new Date().toISOString(),
    }));
    onInsertToSpec(tags);
  };

  return (
    <div className="bg-bg-main border border-border rounded-btn p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-text-secondary uppercase tracking-wider">
          视觉问题清单（{issues.length} 项）
        </span>
        <button
          onClick={onInsertAll}
          className="text-[10px] px-2 py-0.5 rounded-btn bg-brand hover:bg-brand-hover text-white transition-colors"
        >
          插入到规格段
        </button>
      </div>
      <div className="space-y-1.5">
        {issues.map((iss, i) => (
          <div key={i} className="text-[11px]">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  iss.severity === 'high'
                    ? 'bg-red-400'
                    : iss.severity === 'medium'
                      ? 'bg-accent-yellow'
                      : 'bg-text-secondary'
                }`}
              />
              <span className="text-text-primary font-medium">
                {ISSUE_TYPE_LABEL[iss.type]}
              </span>
            </div>
            <div className="text-text-secondary ml-3 mt-0.5">{iss.description}</div>
            <div className="text-brand-hover ml-3 mt-0.5">建议：{iss.suggestion}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
