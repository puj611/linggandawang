// src/engine/PreferenceLearner.ts
// 行为学习器：从用户历史答案中挖掘偏好，提供个性化推荐
// 用途：无 LLM 时也能根据历史行为智能预填，提升基础模式质量

import type { ContextRecentQA, ContextPreference } from '@/types/context';

/** 用户画像 */
export interface UserProfile {
  /** 每题最常选的选项 */
  topChoices: Map<string, { optionId: string; count: number; ratio: number }>;
  /** 趋势：最近 vs 历史的偏好变化 */
  trends: Array<{ tag: string; direction: 'up' | 'down' | 'stable' }>;
  /** 常见模式（如"用户总是选深色+大圆角"） */
  patterns: Array<{ rule: string; confidence: number }>;
}

/** 偏好条目（扩展 ContextRecentQA，添加选项信息） */
export interface PreferenceEntry {
  questionId: string;
  optionId: string;
  timestamp: string;
}

/**
 * 从 QA 历史中提取偏好条目
 * 解析 answer 字段，提取选项 ID
 */
export function extractPreferencesFromQA(qas: ContextRecentQA[]): PreferenceEntry[] {
  const entries: PreferenceEntry[] = [];

  for (const qa of qas) {
    if (!qa.answer || qa.answer === '__skipped__') continue;

    // 尝试从 answer 中提取选项 ID（格式：value 或 label）
    // 这里简化处理，将 answer 作为 optionId
    entries.push({
      questionId: qa.question_id,
      optionId: qa.answer,
      timestamp: qa.answered_at,
    });
  }

  return entries;
}

/**
 * 从 ContextPreference 数组中提取偏好条目
 */
export function extractPreferencesFromPrefs(prefs: ContextPreference[]): PreferenceEntry[] {
  return prefs.map((p) => ({
    questionId: p.key,
    optionId: p.value,
    timestamp: p.confirmed_at,
  }));
}

/**
 * 构建用户画像
 * 分析历史偏好，生成频率统计、趋势和模式
 */
export function buildProfile(entries: PreferenceEntry[]): UserProfile {
  const topChoices = new Map<string, { optionId: string; count: number; ratio: number }>();
  const trends: UserProfile['trends'] = [];
  const patterns: UserProfile['patterns'] = [];

  if (entries.length === 0) {
    return { topChoices, trends, patterns };
  }

  // 1. 频率统计：每题最常选
  const byQuestion = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const qMap = byQuestion.get(entry.questionId) ?? new Map();
    qMap.set(entry.optionId, (qMap.get(entry.optionId) ?? 0) + 1);
    byQuestion.set(entry.questionId, qMap);
  }

  for (const [questionId, optionCounts] of byQuestion) {
    let maxCount = 0;
    let topOption = '';
    let totalCount = 0;

    for (const [optionId, count] of optionCounts) {
      totalCount += count;
      if (count > maxCount) {
        maxCount = count;
        topOption = optionId;
      }
    }

    if (topOption) {
      topChoices.set(questionId, {
        optionId: topOption,
        count: maxCount,
        ratio: totalCount > 0 ? maxCount / totalCount : 0,
      });
    }
  }

  // 2. 时序趋势：最近 5 条 vs 之前的对比
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  if (sorted.length >= 6) {
    const recent = sorted.slice(-5);
    const older = sorted.slice(0, -5);

    const recentByQ = new Map<string, string>();
    for (const e of recent) recentByQ.set(e.questionId, e.optionId);

    const olderByQ = new Map<string, string>();
    for (const e of older) olderByQ.set(e.questionId, e.optionId);

    for (const [qId, recentOpt] of recentByQ) {
      const olderOpt = olderByQ.get(qId);
      if (olderOpt && recentOpt !== olderOpt) {
        // 简化判断：如果选项变了，认为是趋势变化
        trends.push({
          tag: qId,
          direction: 'up', // 简化：实际应基于更复杂的分析
        });
      }
    }
  }

  // 3. 常见模式挖掘：频率 > 3 且一致性 > 70%
  for (const [questionId, choice] of topChoices) {
    if (choice.count >= 3 && choice.ratio >= 0.7) {
      patterns.push({
        rule: `${questionId} → ${choice.optionId}（${choice.count}次，${(choice.ratio * 100).toFixed(0)}%）`,
        confidence: choice.ratio,
      });
    }
  }

  return { topChoices, trends, patterns };
}

/**
 * 基于用户画像预填答案
 * 返回推荐的选项 ID
 */
export function recommendAnswers(
  profile: UserProfile,
  questionIds: string[],
): Map<string, string> {
  const recommendations = new Map<string, string>();

  for (const qId of questionIds) {
    const topChoice = profile.topChoices.get(qId);
    if (topChoice && topChoice.ratio >= 0.6) {
      // 一致性 ≥ 60% 才推荐
      recommendations.set(qId, topChoice.optionId);
    }
  }

  return recommendations;
}

/**
 * 基于用户偏好数组预填
 * 从 ContextPreference 中提取高频偏好
 */
export function recommendFromPreferences(
  preferences: ContextPreference[],
  minCount: number = 2,
): Map<string, string> {
  const recommendations = new Map<string, string>();

  // 统计每个 key 的值频率
  const byKey = new Map<string, Map<string, number>>();
  for (const p of preferences) {
    const vMap = byKey.get(p.key) ?? new Map();
    vMap.set(p.value, (vMap.get(p.value) ?? 0) + 1);
    byKey.set(p.key, vMap);
  }

  for (const [key, valueCounts] of byKey) {
    let maxCount = 0;
    let topValue = '';
    for (const [value, count] of valueCounts) {
      if (count > maxCount) {
        maxCount = count;
        topValue = value;
      }
    }
    if (maxCount >= minCount && topValue) {
      recommendations.set(key, topValue);
    }
  }

  return recommendations;
}
