// src/components/RecentPromptList.tsx
// 最近 3 条提示词：从 SQLite prompt_history 表读取
import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useEngineStore } from '@/stores/engineStore';
import { listPromptHistory, insertPromptHistory, type PromptHistoryRecord } from '@/lib/sqlite';

export interface RecentItem {
  id: number;
  preview: string;
  ts: string;
  markdown: string;
}

const MAX_RECENT = 3;

export async function pushRecentPrompt(md: string): Promise<void> {
  const record: Omit<PromptHistoryRecord, 'id'> = {
    title: md.slice(0, 40).replace(/\n/g, ' ') || '未命名提示词',
    markdown: md,
    tags: [],
    seed_input: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insertPromptHistory(record);
}

export function RecentPromptList() {
  const [items, setItems] = useState<RecentItem[]>([]);
  const transition = useAppStore((s) => s.transition);
  const setResult = useEngineStore((s) => s.setResult);

  useEffect(() => {
    let mounted = true;
    listPromptHistory(MAX_RECENT).then((rows) => {
      if (!mounted) return;
      setItems(
        rows.map((r) => ({
          id: r.id ?? 0,
          preview: r.markdown.slice(0, 60).replace(/\n/g, ' '),
          ts: r.created_at,
          markdown: r.markdown,
        })),
      );
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (items.length === 0) return null;

  const onClick = (item: RecentItem) => {
    setResult({
      project_context: null,
      action: { title: '要做什么', content: item.preview },
      spec: { title: '怎么做', content: '（历史预览，请重新提问以获取完整规格段）' },
      constraint: { title: '不能怎么', content: '' },
      verify: { title: '怎么算做好了', content: '' },
      raw_quotes: [],
      intent_tags: [],
      generated_at: item.ts,
    });
    transition('result');
  };

  return (
    <div className="px-4 py-2 border-t border-border">
      <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">最近 3 条</div>
      <div className="flex flex-col gap-1">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onClick(it)}
            className="text-left text-[11px] text-text-secondary hover:text-text-primary truncate transition-colors"
            title={it.preview}
          >
            · {it.preview}
          </button>
        ))}
      </div>
    </div>
  );
}
