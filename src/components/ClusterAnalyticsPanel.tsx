// src/components/ClusterAnalyticsPanel.tsx
// 词簇命中分析面板：命中率、来源分布、簇命中条形图、最近记录表、时间筛选
import { useMemo, useState } from 'react';
import {
  useAnalyticsStore,
  DATE_RANGES,
  filterByRange,
  computeHitRate,
  computeSourceDistribution,
  computeClusterStats,
  computeDailyHits,
} from '@/stores/analyticsStore';

type TabKey = 'overview' | 'clusters' | 'history';

interface Props {
  onBack: () => void;
}

export function ClusterAnalyticsPanel({ onBack }: Props) {
  const records = useAnalyticsStore((s) => s.records);
  const clearAll = useAnalyticsStore((s) => s.clearAll);
  const [rangeKey, setRangeKey] = useState<string>('7d');
  const [tab, setTab] = useState<TabKey>('overview');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => filterByRange(records, rangeKey), [records, rangeKey]);
  const hitRate = useMemo(() => computeHitRate(filtered), [filtered]);
  const sourceDist = useMemo(() => computeSourceDistribution(filtered), [filtered]);
  const clusterStats = useMemo(() => computeClusterStats(filtered), [filtered]);
  const dailyHits = useMemo(() => computeDailyHits(filtered), [filtered]);

  const maxClusterHit = clusterStats[0]?.hitCount ?? 1;
  const maxDailyHit = dailyHits.reduce((m, d) => Math.max(m, d.total), 1);

  const onClear = () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    clearAll();
    setConfirmClear(false);
  };

  const formatTime = (ts: string | null) => {
    if (!ts) return '-';
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="text-text-secondary hover:text-text-primary text-xs flex items-center gap-1"
            aria-label="返回设置"
          >
            ← 返回
          </button>
          <span className="text-text-primary text-sm font-medium">词簇命中分析</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value)}
            className="bg-bg-main border border-border rounded-btn px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-brand"
          >
            {Object.entries(DATE_RANGES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-4 flex-shrink-0" role="tablist" aria-label="分析视图">
        {([
          { k: 'overview', label: '概览' },
          { k: 'clusters', label: '簇分布' },
          { k: 'history', label: `最近记录（${filtered.length}）` },
        ] as const).map((t) => (
          <button
            key={t.k}
            role="tab"
            aria-selected={tab === t.k}
            onClick={() => setTab(t.k as TabKey)}
            className={`px-3 py-2 text-[11px] border-b-2 transition-colors ${
              tab === t.k
                ? 'text-text-primary border-brand'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* 核心指标卡片 */}
            <div className="grid grid-cols-4 gap-2">
              <StatCard label="总提问" value={hitRate.total} accent="neutral" />
              <StatCard label="命中" value={hitRate.hitCount} accent="brand" sub={`${Math.round(hitRate.hitRate * 100)}%`} />
              <StatCard label="未命中" value={hitRate.missCount} accent="warn" />
              <StatCard label="识别簇" value={clusterStats.length} accent="accent" />
            </div>

            {hitRate.total === 0 ? (
              <EmptyHint />
            ) : (
              <>
                {/* 来源分布饼图 */}
                <div>
                  <div className="text-[11px] text-text-secondary mb-2">路由来源分布</div>
                  <div className="flex items-center gap-4">
                    <SourcePie keyword={sourceDist.keyword} cluster={sourceDist.cluster} fallback={sourceDist.fallback} />
                    <div className="flex-1 space-y-1.5">
                      <LegendDot color="#6E56CF" label="关键词匹配" count={sourceDist.keyword} total={hitRate.total} />
                      <LegendDot color="#8B6FE8" label="词簇匹配" count={sourceDist.cluster} total={hitRate.total} />
                      <LegendDot color="#5A5A62" label="兜底" count={sourceDist.fallback} total={hitRate.total} />
                    </div>
                  </div>
                </div>

                {/* 每日趋势 */}
                {dailyHits.length > 0 && (
                  <div>
                    <div className="text-[11px] text-text-secondary mb-2">每日提问趋势</div>
                    <div className="flex items-end justify-center gap-1 h-20 bg-bg-main rounded-btn p-2 border border-border">
                      {dailyHits.slice(-14).map((d) => (
                        <div
                          key={d.date}
                          className="flex flex-col items-center gap-1"
                          style={{ flex: '1 1 0', maxWidth: '28px' }}
                          title={`${d.date}：总 ${d.total} 次（命中 ${d.hit}，未命中 ${d.miss}）`}
                        >
                          <div className="w-full flex flex-col justify-end h-12">
                            {d.miss > 0 && (
                              <div
                                className="w-full bg-[#5A5A62] transition-all"
                                style={{ height: `${(d.miss / maxDailyHit) * 100}%`, minHeight: '2px' }}
                              />
                            )}
                            <div
                              className="w-full bg-brand rounded-t-sm transition-all"
                              style={{ height: `${(d.hit / maxDailyHit) * 100}%`, minHeight: d.hit > 0 ? '3px' : 0 }}
                            />
                          </div>
                          <span className="text-[9px] text-text-tertiary">{d.date.slice(5)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'clusters' && (
          <div className="space-y-2">
            <div className="text-[11px] text-text-secondary mb-1">
              共识别到 {clusterStats.length} 个不同词簇
            </div>
            {clusterStats.length === 0 ? (
              <EmptyHint />
            ) : (
              clusterStats.slice(0, 20).map((cs) => (
                <div key={cs.clusterId} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-primary font-medium">{cs.clusterId}</span>
                    <span className="text-text-secondary">
                      {cs.hitCount} 次 · {formatTime(cs.lastHitAt)}
                    </span>
                  </div>
                  <div className="h-2 bg-bg-main rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full transition-all"
                      style={{ width: `${(cs.hitCount / maxClusterHit) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'history' && (
          <div>
            {filtered.length === 0 ? (
              <EmptyHint />
            ) : (
              <div className="border border-border rounded-btn overflow-hidden">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-bg-main text-text-secondary">
                      <th className="px-2 py-1.5 text-left font-normal">时间</th>
                      <th className="px-2 py-1.5 text-left font-normal">输入</th>
                      <th className="px-2 py-1.5 text-left font-normal">来源</th>
                      <th className="px-2 py-1.5 text-left font-normal">命中簇/关键词</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filtered].reverse().slice(0, 50).map((r) => (
                      <tr key={r.id} className="border-t border-border hover:bg-bg-card-hover">
                        <td className="px-2 py-1.5 text-text-secondary whitespace-nowrap">{formatTime(r.timestamp)}</td>
                        <td className="px-2 py-1.5 text-text-primary max-w-[180px] truncate" title={r.seed}>{r.seed}</td>
                        <td className="px-2 py-1.5">
                          <SourceBadge source={r.routeSource} dynamic={r.hasDynamicClarification} />
                        </td>
                        <td className="px-2 py-1.5 text-text-secondary">
                          <div className="flex flex-wrap gap-1">
                            {r.routeSource === 'keyword' && r.matchedKeywords.map((k) => (
                              <span key={k} className="px-1 py-0.5 bg-[#2A1F3D] text-brand rounded text-[9px]">kw:{k}</span>
                            ))}
                            {r.matchedClusterForms.slice(0, 3).map((f, i) => (
                              <span key={i} className="px-1 py-0.5 bg-[#1F2540] text-[#8B9AE8] rounded text-[9px]">{f}</span>
                            ))}
                            {r.matchedClusterForms.length > 3 && (
                              <span className="text-text-tertiary text-[9px]">+{r.matchedClusterForms.length - 3}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border flex-shrink-0">
        <span className="text-[10px] text-text-tertiary">最多保留最近 {500} 条记录</span>
        <button
          onClick={onClear}
          className={`px-3 py-1 text-[10px] rounded-btn transition-colors ${
            confirmClear
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'border border-border text-text-secondary hover:text-text-primary'
          }`}
        >
          {confirmClear ? '再次点击确认清空' : '清空数据'}
        </button>
      </div>
    </div>
  );
}

// ─────────── 子组件 ───────────

function StatCard({
  label, value, sub, accent,
}: { label: string; value: number; sub?: string; accent: 'brand' | 'warn' | 'accent' | 'neutral' }) {
  const colors: Record<string, string> = {
    brand: 'text-brand',
    warn: 'text-[#D97757]',
    accent: 'text-[#ffd580]',
    neutral: 'text-text-primary',
  };
  return (
    <div className="bg-bg-main border border-border rounded-btn p-2">
      <div className="text-[9px] text-text-secondary">{label}</div>
      <div className={`text-lg font-semibold ${colors[accent]}`}>{value}</div>
      {sub && <div className="text-[9px] text-text-tertiary">{sub}</div>}
    </div>
  );
}

function LegendDot({ color, label, count, total }: { color: string; label: string; count: number; total: number }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="text-text-secondary">{label}</span>
      </div>
      <span className="text-text-primary tabular-nums">
        {count} <span className="text-text-tertiary">({pct(count, total)}%)</span>
      </span>
    </div>
  );
}

function pct(n: number, total: number) {
  return total === 0 ? '0' : Math.round((n / total) * 100);
}

function SourcePie({ keyword, cluster, fallback }: { keyword: number; cluster: number; fallback: number }) {
  const total = keyword + cluster + fallback;
  if (total === 0) return <div className="w-20 h-20 rounded-full bg-[#2A2A32]" />;

  // SVG 饼图：conic-gradient 实现
  const kwEnd = (keyword / total) * 360;
  const clEnd = kwEnd + (cluster / total) * 360;
  const bg = `conic-gradient(
    #6E56CF 0deg ${kwEnd}deg,
    #8B6FE8 ${kwEnd}deg ${clEnd}deg,
    #5A5A62 ${clEnd}deg 360deg
  )`;
  return (
    <div
      className="w-20 h-20 rounded-full flex-shrink-0 relative"
      style={{ background: bg }}
    >
      <div className="absolute inset-2 rounded-full bg-bg-card" />
    </div>
  );
}

function SourceBadge({ source, dynamic }: { source: 'keyword' | 'cluster' | 'fallback' | 'llm'; dynamic?: boolean }) {
  if (source === 'llm') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="px-1.5 py-0.5 bg-[#1F2A3D] text-[#5BA3E8] rounded text-[9px]">LLM</span>
        {dynamic && <span className="px-1 py-0.5 bg-[#3D2F1F] text-[#ffd580] rounded text-[9px]">澄清题</span>}
      </span>
    );
  }
  if (source === 'keyword') {
    return <span className="px-1.5 py-0.5 bg-[#2A1F3D] text-brand rounded text-[9px]">关键词</span>;
  }
  if (source === 'cluster') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="px-1.5 py-0.5 bg-[#1F2540] text-[#8B9AE8] rounded text-[9px]">词簇</span>
        {dynamic && <span className="px-1 py-0.5 bg-[#3D2F1F] text-[#ffd580] rounded text-[9px]">澄清题</span>}
      </span>
    );
  }
  return <span className="px-1.5 py-0.5 bg-[#2A2A32] text-text-tertiary rounded text-[9px]">兜底</span>;
}

function EmptyHint() {
  return (
    <div className="py-10 text-center text-text-tertiary">
      <div className="mb-3 opacity-50 flex items-end justify-center gap-1 h-8">
        <div className="w-1.5 h-3 bg-current rounded-sm" />
        <div className="w-1.5 h-5 bg-current rounded-sm" />
        <div className="w-1.5 h-7 bg-current rounded-sm" />
        <div className="w-1.5 h-4 bg-current rounded-sm opacity-60" />
      </div>
      <div className="text-[11px]">暂无数据，去问几个问题试试？</div>
    </div>
  );
}
