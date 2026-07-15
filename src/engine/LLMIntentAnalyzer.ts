// src/engine/LLMIntentAnalyzer.ts
// LLM 意图分析器：将用户模糊描述转化为结构化意图分析
// 调用现有 src/lib/llm/ 的 OpenAI 兼容适配器，降级时回退到 seedRouter 的关键词匹配

import { getAdapter } from '@/lib/llm';
import type { LLMResponse } from '@/lib/llm/types';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useLLMAvailabilityStore } from '@/stores/llmAvailabilityStore';
import { buildIntentAnalysisMessages } from './prompts/intent-analysis';
import type { TagScore, SceneType } from './types';

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

const DEFAULT_TIMEOUT_MS = 8000; // full 模式 LLM 分析超时 8 秒
const QUICK_TIMEOUT_MS = 4000; // quick 模式 LLM 分析超时 4 秒（P3 快速通道：更快降级到规则路由）
// Phase B：本地模型推理较慢，超时时间更长
const LOCAL_DEFAULT_TIMEOUT_MS = 30000; // 本地模型 full 模式 30 秒
const LOCAL_QUICK_TIMEOUT_MS = 15000; // 本地模型 quick 模式 15 秒

/**
 * 分析用户意图
 * - LLM 可用时：调用 LLM 获取结构化意图分析
 * - LLM 不可用或超时：返回 null，调用方降级到关键词匹配
 * - P3 快速通道：quick 模式下超时从 8s 降到 4s，LLM 慢时更快降级
 */
export async function analyzeIntent(
  seed: string,
  projectStack?: string,
  recentQA?: Array<{ question: string; answer: string }>,
  mode: 'quick' | 'full' = 'full',
): Promise<LLMIntentAnalysis | null> {
  const { config, hasApiKey } = useApiKeyStore.getState();
  if (!config || !hasApiKey) {
    return null; // 未配置 LLM，降级
  }

  // r5增强：熔断器检查，熔断期间直接降级，避免每次都等超时
  if (!useLLMAvailabilityStore.getState().shouldAttempt()) {
    console.info('[LLMIntentAnalyzer] 熔断中，直接降级到关键词匹配');
    return null;
  }

  const apiKey = await useApiKeyStore.getState().getApiKey();
  if (!apiKey) return null;

  const adapter = getAdapter(config.provider);
  const messages = buildIntentAnalysisMessages(seed, projectStack, recentQA);

  // Phase B：本地模型用更长超时，云端保持原有超时
  const isLocal = config.provider === 'local';
  const timeoutMs = mode === 'quick'
    ? (isLocal ? LOCAL_QUICK_TIMEOUT_MS : QUICK_TIMEOUT_MS)
    : (isLocal ? LOCAL_DEFAULT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response: LLMResponse = await adapter.chat(
      {
        messages,
        model: config.model,
        temperature: 0.3, // 低温度保证结构化输出稳定
        max_tokens: 800,
      },
      apiKey,
      config.baseUrl,
      controller.signal, // 传入外部 signal，使 8s 超时实际生效
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
    // r5增强：调用成功，重置熔断器
    useLLMAvailabilityStore.getState().recordSuccess();
    return analysis;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[LLMIntentAnalyzer] LLM 分析失败，降级到关键词匹配', msg);
    // r5增强：记录失败，达阈值会触发熔断
    useLLMAvailabilityStore.getState().recordFailure(e);
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

/** 规范化 LLM 输出，确保字段完整且类型正确（导出用于单元测试） */
export function normalizeAnalysis(raw: unknown): LLMIntentAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const scene = r.scene === 'backend-api' ? 'backend-api' : r.scene === 'fullstack' ? 'fullstack' : 'frontend-ui';

  const pain_points = Array.isArray(r.pain_points)
    ? (r.pain_points as unknown[])
        .slice(0, 5)
        .map((pp) => {
          const p = (pp ?? {}) as Record<string, unknown>;
          return {
            text: String(p.text ?? ''),
            dimension: String(p.dimension ?? '其他'),
            severity: Math.min(5, Math.max(1, Number(p.severity) || 3)),
          };
        })
    : [];

  const detected_dimensions = Array.isArray(r.detected_dimensions)
    ? (r.detected_dimensions as unknown[])
        .slice(0, 8)
        .map((d) => {
          const dim = (d ?? {}) as Record<string, unknown>;
          return {
            tag: String(dim.tag ?? ''),
            weight: Math.min(1, Math.max(0, Number(dim.weight) || 0.5)),
            confidence: Math.min(1, Math.max(0, Number(dim.confidence) || 0.5)),
          };
        })
    : [];

  // 权重归一化
  const totalWeight = detected_dimensions.reduce((sum, d) => sum + d.weight, 0);
  if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.01) {
    for (const d of detected_dimensions) {
      d.weight = d.weight / totalWeight;
    }
  }

  const urgency = r.urgency === 'high' ? 'high' : r.urgency === 'low' ? 'low' : 'medium';
  const ambiguity_score = Math.min(1, Math.max(0, Number(r.ambiguity_score) || 0));
  const suggested_followup = r.suggested_followup ? String(r.suggested_followup) : null;
  const followup_options = Array.isArray(r.followup_options)
    ? (r.followup_options as unknown[]).slice(0, 4).map((o) => String(o))
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
