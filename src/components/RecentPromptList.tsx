// src/components/RecentPromptList.tsx
// 历史提示词列表：支持搜索、收藏筛选、展开收起、删除（最多 20 条）
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useEngineStore } from '@/stores/engineStore';
import {
  listPromptHistory,
  searchPromptHistory,
  togglePromptFavorite,
  deletePromptHistory,
  insertPromptHistory,
  type PromptHistoryRecord,
} from '@/lib/sqlite';

export interface RecentItem {
  id: number;
  preview: string;
  ts: string;
  markdown: string;
  seedInput: string;
  tagCount: number;
  favorite: boolean;
}

const MAX_RECENT = 20;
// 默认显示条数，点击"查看全部"后展开到 MAX_RECENT
const DEFAULT_VISIBLE = 5;

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

// 相对时间格式化：刚刚 / X分钟前 / X小时前 / X天前 / X个月前
function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < month) return `${Math.floor(diff / day)}天前`;
  return `${Math.floor(diff / month)}个月前`;
}

export function RecentPromptList() {
  const [items, setItems] = useState<RecentItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [onlyFavorite, setOnlyFavorite] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const transition = useAppStore((s) => s.transition);
  const setResult = useEngineStore((s) => s.setResult);

  // 重新加载历史记录：搜索与收藏筛选可叠加
  const reload = useCallback(async () => {
    let rows: PromptHistoryRecord[];
    const kw = keyword.trim();
    if (kw) {
      // 搜索模式：先按关键词查 title/markdown，再在客户端按收藏过滤
      rows = await searchPromptHistory(kw, MAX_RECENT);
      if (onlyFavorite) rows = rows.filter((r) => r.favorite === true);
    } else {
      rows = await listPromptHistory(MAX_RECENT, onlyFavorite);
    }
    setItems(
      rows.map((r) => ({
        id: r.id ?? 0,
        preview: r.markdown.slice(0, 60).replace(/\n/g, ' '),
        ts: r.created_at,
        markdown: r.markdown,
        seedInput: r.seed_input || '',
        tagCount: Array.isArray(r.tags) ? r.tags.length : 0,
        favorite: r.favorite === true,
      })),
    );
  }, [keyword, onlyFavorite]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onToggleFavorite = useCallback(
    async (id: number, favorite: boolean) => {
      await togglePromptFavorite(id, favorite);
      reload();
    },
    [reload],
  );

  const onDelete = useCallback(
    async (id: number) => {
      await deletePromptHistory(id);
      reload();
    },
    [reload],
  );

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

  // 无任何历史且未在搜索/筛选时，整块隐藏
  if (items.length === 0 && !keyword && !onlyFavorite) return null;

  const visibleCount = expanded ? MAX_RECENT : DEFAULT_VISIBLE;
  const visibleItems = items.slice(0, visibleCount);
  const hasMore = items.length > DEFAULT_VISIBLE;

  return (
    <div className="px-4 py-2 border-t border-border">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-text-secondary uppercase tracking-wider">
          历史记录{onlyFavorite ? ' · 收藏' : ''}
        </span>
        <button
          type="button"
          onClick={() => setOnlyFavorite((v) => !v)}
          className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
            onlyFavorite ? 'text-amber-400' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={onlyFavorite ? '显示全部' : '只看收藏'}
        >
          {onlyFavorite ? '★ 收藏中' : '☆ 收藏'}
        </button>
      </div>

      {/* 搜索输入框 */}
      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索历史提示词…"
        className="w-full mb-1.5 px-2 py-1 text-[11px] bg-surface-2 border border-border rounded text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-light"
      />

      {/* 列表 */}
      {visibleItems.length === 0 ? (
        <div className="text-[11px] text-text-secondary py-2 text-center">
          {keyword || onlyFavorite ? '没有匹配的历史记录' : '暂无历史记录'}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {visibleItems.map((it) => (
            <div
              key={it.id}
              className="group relative flex items-start gap-1 rounded px-1 py-1 hover:bg-surface-2 transition-colors"
            >
              <button
                type="button"
                onClick={() => onClick(it)}
                className="flex-1 text-left min-w-0"
                title={it.preview}
              >
                <div className="text-[11px] text-text-secondary hover:text-text-primary truncate transition-colors">
                  · {it.preview}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[9px] text-text-tertiary">
                  {it.seedInput && (
                    <span className="truncate max-w-[80px]" title={it.seedInput}>
                      种子: {it.seedInput}
                    </span>
                  )}
                  <span>{it.tagCount} 标签</span>
                  <span>{formatRelativeTime(it.ts)}</span>
                </div>
              </button>
              {/* 收藏切换 */}
              <button
                type="button"
                onClick={() => onToggleFavorite(it.id, !it.favorite)}
                className={`shrink-0 text-[11px] leading-none px-1 opacity-70 hover:opacity-100 transition-opacity ${
                  it.favorite ? 'text-amber-400' : 'text-text-secondary'
                }`}
                title={it.favorite ? '取消收藏' : '收藏'}
              >
                {it.favorite ? '★' : '☆'}
              </button>
              {/* 删除按钮：hover 显示 */}
              <button
                type="button"
                onClick={() => onDelete(it.id)}
                className="shrink-0 text-[11px] leading-none px-1 text-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="删除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 查看全部 / 收起 */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
        >
          {expanded ? '收起' : `查看全部 (${items.length})`}
        </button>
      )}
    </div>
  );
}
