// src/engine/LLMIntentAnalyzer.ts
// LLM 意图分析器：将用户模糊描述转化为结构化意图分析
// 调用现有 src/lib/llm/ 的 OpenAI 兼容适配器，降级时回退到 seedRouter 的关键词匹配

import { getAdapter } from '@/lib/llm';
import type { LLMResponse } from '@/lib/llm/types';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { buildIntentAnalysisMessages } from './prompts/intent-analysis';
import type { TagScore } from './types';
import type { SceneType } from './seedRouter';

/** LLM 意图分析结果 */
export interface LLMIntentAnalysis {
  scene: SceneType | 'fullstack';
  pain_points: Array<{
    text: string;
    dimension: string;
    severity: number; // 1-5
  }>;
  detected_dimensions: Array<{
    tag: string;
    weight: number; // 0-1
    confidence: number; // 0-1
  }>;
  urgency: 'low' | 'medium' | 'high';
  ambiguity_score: number; // 0-1
  suggested_followup: string | null;
  followup_options: string[];
  /** 分析来源：llm 或 fallback（降级到关键词匹配） */
  source: 'llm' | 'fallback';
}

/** 将 LLM 分析结果转换为 Selector 可用的 TagScore[] */
export function analysisToTagScores(analysis: LLMIntentAnalysis): TagScore[] {
  return analysis.detected_dimensions.map((d) => ({
    tag: d.tag,
    weight: d.weight,
    source_clusters: ['llm-analysis'],
  }));
}

/** 从 LLM 分析结果生成意图标签（用于 extractFromSeed 替代品） */
export function analysisToIntentTags(
  analysis: LLMIntentAnalysis,
): Array<{ label: string; value: string }> {
  const tags: Array<{ label: string; value: string }> = [];
  for (const pp of analysis.pain_points) {
    const parts = pp.dimension.split(':');
    const label = parts[0] || '痛点';
    const value = parts[1] || pp.text;
    tags.push({ label, value });
  }
  // 补充 detected_dimensions 中的标签
  for (const dim of analysis.detected_dimensions) {
    const parts = dim.tag.split(':');
    if (parts.length >= 2) {
      tags.push({ label: parts[0], value: parts[1] });
    }
  }
  return tags;
}

const TIMEOUT_MS = 8000; // LLM 分析超时 8 秒，超时后降级

/**
 * 分析用户意图
 * - LLM 可用时：调用 LLM 获取结构化意图分析
 * - LLM 不可用或超时：返回 null，调用方降级到关键词匹配
 */
export async function analyzeIntent(
  seed: string,
  projectStack?: string,
  recentQA?: Array<{ question: string; answer: string }>,
): Promise<LLMIntentAnalysis | null> {
  const { config, hasApiKey } = useApiKeyStore.getState();
  if (!config || !hasApiKey) {
    return null; // 未配置 LLM，降级
  }

  const apiKey = await useApiKeyStore.getState().getApiKey();
  if (!apiKey) return null;

  const adapter = getAdapter(config.provider);
  const messages = buildIntentAnalysisMessages(seed, projectStack, recentQA);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response: LLMResponse = await adapter.chat(
      {
        messages,
        model: config.model,
        temperature: 0.3, // 低温度保证结构化输出稳定
        max_tokens: 800,
      },
      apiKey,
      config.baseUrl,
    );

    clearTimeout(timeout);

    const analysis = parseLLMResponse(response.content);
    if (analysis) {
      console.info('[LLMIntentAnalyzer] LLM 分析成功', {
        scene: analysis.scene,
        dimensions: analysis.detected_dimensions.length,
        ambiguity: analysis.ambiguity_score,
      });
    }
    return analysis;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[LLMIntentAnalyzer] LLM 分析失败，降级到关键词匹配', msg);
    return null;
  }
}

/** 解析 LLM 返回的 JSON，容错处理 */
function parseLLMResponse(content: string): LLMIntentAnalysis | null {
  // 尝试直接解析
  let jsonStr = content.trim();

  // 去除可能的 markdown 代码块包裹
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const raw = JSON.parse(jsonStr);
    return normalizeAnalysis(raw);
  } catch {
    // 尝试提取 JSON 片段
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const raw = JSON.parse(match[0]);
        return normalizeAnalysis(raw);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 规范化 LLM 输出，确保字段完整且类型正确 */
function normalizeAnalysis(raw: any): LLMIntentAnalysis {
  const scene = raw.scene === 'backend-api' ? 'backend-api' : raw.scene === 'fullstack' ? 'fullstack' : 'frontend-ui';

  const pain_points = Array.isArray(raw.pain_points)
    ? raw.pain_points.slice(0, 5).map((pp: any) => ({
        text: String(pp.text ?? ''),
        dimension: String(pp.dimension ?? '其他'),
        severity: Math.min(5, Math.max(1, Number(pp.severity) || 3)),
      }))
    : [];

  const detected_dimensions = Array.isArray(raw.detected_dimensions)
    ? raw.detected_dimensions.slice(0, 8).map((d: any) => ({
        tag: String(d.tag ?? ''),
        weight: Math.min(1, Math.max(0, Number(d.weight) || 0.5)),
        confidence: Math.min(1, Math.max(0, Number(d.confidence) || 0.5)),
      }))
    : [];

  // 权重归一化
  const totalWeight = detected_dimensions.reduce((sum: number, d: any) => sum + d.weight, 0);
  if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.01) {
    for (const d of detected_dimensions) {
      d.weight = d.weight / totalWeight;
    }
  }

  const urgency = raw.urgency === 'high' ? 'high' : raw.urgency === 'low' ? 'low' : 'medium';
  const ambiguity_score = Math.min(1, Math.max(0, Number(raw.ambiguity_score) || 0));
  const suggested_followup = raw.suggested_followup ? String(raw.suggested_followup) : null;
  const followup_options = Array.isArray(raw.followup_options)
    ? raw.followup_options.slice(0, 4).map((o: any) => String(o))
    : [];

  return {
    scene,
    pain_points,
    detected_dimensions,
    urgency,
    ambiguity_score,
    suggested_followup,
    followup_options,
    source: 'llm',
  };
}
