// src/engine/ImagePromptExtractor.ts
// 图片提示词拆解引擎：分析图片内容，生成结构化提示词

import { getAdapter } from '@/lib/llm';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useLLMAvailabilityStore } from '@/stores/llmAvailabilityStore';
import { classifyLLMError } from '@/lib/llm/error-messages';
import type { ContentPart, LLMResponse } from '@/lib/llm/types';

/** 拆解结果 */
export interface ExtractedPrompt {
  /** 场景描述 */
  scene: string;
  /** 主体元素 */
  subjects: string[];
  /** 风格特征 */
  style: string[];
  /** 色彩方案 */
  colors: string[];
  /** 构图/布局 */
  layout: string;
  /** 氛围/情绪 */
  mood: string;
  /** 完整提示词（可直接使用） */
  fullPrompt: string;
}

/** 拆解请求参数 */
export interface ExtractRequest {
  /** 图片 dataUrl（base64） */
  dataUrl: string;
  /** 用户补充描述（可选） */
  userHint?: string;
}

const SYSTEM_PROMPT = `你是一个专业的图片提示词分析师。你的任务是分析用户提供的图片，拆解出可用于 AI 图像生成的结构化提示词。

请按以下格式输出（每行一个字段，用 | 分隔）：
SCENE|场景描述（一句话概括图片内容）
SUBJECTS|主体元素1,主体元素2,...
STYLE|风格1,风格2,...
COLORS|颜色1,颜色2,...
LAYOUT|构图和布局描述
MOOD|氛围和情绪
PROMPT|完整的英文提示词（可直接用于 Midjourney/Stable Diffusion）

要求：
1. 场景描述要精准，包含环境、时间、视角等信息
2. 主体元素要具体，包含物体、人物、动作等
3. 风格特征要明确，如：写实、动漫、油画、极简、赛博朋克等
4. 色彩方案要包含主色调和辅助色
5. 构图描述要包含视角、层次、焦点等
6. 完整提示词要用英文，适合 AI 绘图工具使用
7. 如果图片有明显的设计风格（如 UI 设计），要特别标注`;

/** 图片拆解超时时间（视觉模型较慢，给 20s） */
const EXTRACT_TIMEOUT_MS = 20000;

function parseResponse(content: string): ExtractedPrompt {
  const lines = content.split('\n').filter(line => line.includes('|'));
  const result: Record<string, string> = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split('|');
    const value = valueParts.join('|').trim();
    if (key && value) {
      result[key.trim()] = value;
    }
  }

  const subjects = (result['SUBJECTS'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const style = (result['STYLE'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const colors = (result['COLORS'] || '').split(',').map(s => s.trim()).filter(Boolean);

  return {
    scene: result['SCENE'] || '未能识别场景',
    subjects,
    style,
    colors,
    layout: result['LAYOUT'] || '未能识别构图',
    mood: result['MOOD'] || '未能识别氛围',
    fullPrompt: result['PROMPT'] || '',
  };
}

export class ImagePromptExtractor {
  /**
   * 拆解图片提示词
   */
  async extract(request: ExtractRequest): Promise<ExtractedPrompt> {
    const { dataUrl, userHint } = request;

    // 获取 LLM 配置
    const { config, hasApiKey } = useApiKeyStore.getState();
    if (!config || !hasApiKey) {
      throw new Error(
        '图片拆解是高级功能，需在设置中配置 LLM 与 API Key 后使用。核心提问流程无需配置即可使用。',
      );
    }

    // r5增强：熔断器检查，熔断期间直接抛友好错误
    if (!useLLMAvailabilityStore.getState().shouldAttempt()) {
      const statusMsg = useLLMAvailabilityStore.getState().getStatusMessage();
      throw new Error(
        statusMsg?.text ?? 'AI 智能增强暂时不可用，已切换为基础模式。请稍后重试或检查 LLM 配置。',
      );
    }

    const apiKey = await useApiKeyStore.getState().getApiKey();
    if (!apiKey) {
      throw new Error('无法获取 API Key，请重新配置');
    }

    const userContent: ContentPart[] = [
      {
        type: 'text',
        text: userHint
          ? `请分析这张图片并拆解提示词。用户补充说明：${userHint}`
          : '请分析这张图片并拆解提示词。',
      },
      {
        type: 'image_url',
        image_url: {
          url: dataUrl,
          detail: 'high',
        },
      },
    ];

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: userContent },
    ];

    try {
      const adapter = getAdapter(config.provider);
      // 新增超时控制（视觉模型较慢，给 20s，超过则抛错让用户感知）
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

      let response: LLMResponse;
      try {
        response = await adapter.chat(
          {
            messages,
            model: config.model,
            temperature: 0.3,
            max_tokens: 1000,
          },
          apiKey,
          config.baseUrl,
          controller.signal,
        );
      } finally {
        clearTimeout(timeout);
      }

      // r5增强：调用成功，重置熔断器
      useLLMAvailabilityStore.getState().recordSuccess();
      return parseResponse(response.content);
    } catch (error) {
      console.error('[ImagePromptExtractor] 拆解失败:', error);
      // r5增强：记录失败，达阈值会触发熔断
      useLLMAvailabilityStore.getState().recordFailure(error);

      // r5增强：用 classifyLLMError 生成友好错误提示
      const classified = classifyLLMError(error);
      // 区分超时与其他错误，给用户更明确的提示
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `图片拆解超时（${EXTRACT_TIMEOUT_MS / 1000}秒），视觉模型响应过慢，请更换模型或重试`,
        );
      }
      throw new Error(
        `图片拆解失败：${classified.friendlyMessage}${classified.suggestion ? `（${classified.suggestion}）` : ''}`,
      );
    }
  }
}

export const imagePromptExtractor = new ImagePromptExtractor();
