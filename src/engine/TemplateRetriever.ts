// src/engine/TemplateRetriever.ts
// 规则模板库：预置高质量 prompt 模板，按场景/意图标签检索最匹配的模板
// 用途：无 LLM 时也能生成高质量提示词，提升基础模式质量

import type { IntentTag } from '@/types/intent-tag';
import type { ContextRecentQA } from '@/types/context';

/** 场景模板 */
export interface PromptTemplate {
  id: string;
  /** 模板名称 */
  name: string;
  /** 适用场景标签 */
  scene: string[];
  /** 触发标签（命中任一即匹配） */
  triggerTags: string[];
  /** 动作段模板 */
  action: string;
  /** 规格段模板（含占位符 {{变量名}}） */
  spec: string;
  /** 约束段模板 */
  constraint: string;
  /** 验证段模板 */
  verify: string;
  /** 相似度权重（用于排序） */
  popularity: number;
}

/** 预置模板库 */
const TEMPLATE_LIBRARY: PromptTemplate[] = [
  // ─── 场景 1：修 UI 间距 ───
  {
    id: 'fix-spacing',
    name: '修复间距问题',
    scene: ['修UI'],
    triggerTags: ['间距', '太挤', '留白', '内边距', '间距不统一'],
    action: '将{{target}}的间距调整为更舒适的排版',
    spec: `布局: 标准
内边距: 16px
行距: 20px
元素间距: 12px
模块间距: 24px`,
    constraint: '不得改变现有组件结构，仅调整间距相关样式',
    verify: '间距实测值符合规格段要求（偏差 ≤ 2px）',
    popularity: 0.9,
  },
  // ─── 场景 2：修圆角 ───
  {
    id: 'fix-radius',
    name: '统一圆角风格',
    scene: ['修UI'],
    triggerTags: ['圆角', '弧度', '边角'],
    action: '将{{target}}的圆角统一为一致的风格',
    spec: `圆角: 8px（标准圆角，像 Notion/大多数现代网站）
按钮圆角: 8px
卡片圆角: 12px
输入框圆角: 8px`,
    constraint: '所有同类组件的圆角必须一致',
    verify: '圆角实测值符合规格段要求',
    popularity: 0.85,
  },
  // ─── 场景 3：修改配色 ───
  {
    id: 'fix-color',
    name: '调整配色方案',
    scene: ['修UI'],
    triggerTags: ['配色', '颜色', '主色', '背景色', '对比度'],
    action: '将{{target}}的配色调整为更和谐的方案',
    spec: `配色方案: 浅色简洁（像 Notion/飞书）
背景: #FFFFFF
主色: #8B5CF6（紫色）
文字主色: #F0F0F5
文字次要: #A0A0B8
边框: rgba(255,255,255,0.06)`,
    constraint: '保持现有色彩层级关系，仅调整色值',
    verify: '文字与背景对比度 ≥ 4.5:1（WCAG AA）',
    popularity: 0.88,
  },
  // ─── 场景 4：修改字体/字号 ───
  {
    id: 'fix-typography',
    name: '优化字体排版',
    scene: ['修UI'],
    triggerTags: ['字号', '字体', '排版', '文字大小'],
    action: '优化{{target}}的字体排版层级',
    spec: `正文字号: 14px
标题字号: 18px
辅助文字: 12px
行高: 1.6
字体栈: Inter, PingFang SC, -apple-system, sans-serif`,
    constraint: '保持现有字体栈，仅调整字号和行高',
    verify: '字号实测值符合规格段要求',
    popularity: 0.8,
  },
  // ─── 场景 5：修改风格方向 ───
  {
    id: 'style-minimal',
    name: '极简风格',
    scene: ['修UI', '加细节'],
    triggerTags: ['极简', '简约', '简洁', '像Apple', '像Linear'],
    action: '将整体风格调整为极简克制的方向',
    spec: `风格方向: 极简（像 Apple/Linear）
间距: 宽松（内边距 24px）
圆角: 0px（直角）
阴影: 无（纯扁平）
配色: 浅色简洁`,
    constraint: '移除不必要的装饰元素，保持留白充足',
    verify: '视觉上符合极简风格特征',
    popularity: 0.85,
  },
  // ─── 场景 6：科技感风格 ───
  {
    id: 'style-tech',
    name: '科技未来风格',
    scene: ['修UI'],
    triggerTags: ['科技', '未来', '赛博', 'VS Code', 'Vercel'],
    action: '将整体风格调整为科技未来感',
    spec: `风格方向: 科技（像 Vercel/VS Code）
背景: #0F0F12（深色）
主色: #3B82F6（蓝色）
圆角: 4px（锐利）
边框: 1px solid rgba(255,255,255,0.1)`,
    constraint: '深色主题，冷色调，锐利边角',
    verify: '视觉上符合科技风格特征',
    popularity: 0.82,
  },
  // ─── 场景 7：添加 hover 反馈 ───
  {
    id: 'add-hover',
    name: '添加悬停反馈',
    scene: ['加细节'],
    triggerTags: ['hover', '悬停', '鼠标', '反馈', '交互'],
    action: '为{{target}}添加鼠标悬停时的视觉反馈',
    spec: `hover 效果:
- 背景色变化: bg-surface-hover
- 阴影增强: shadow-card-hover
- 过渡动画: 200ms ease-out
- 边框高亮: border-border-light`,
    constraint: '仅添加视觉反馈，不改变点击行为',
    verify: '鼠标悬停时有明显的视觉变化',
    popularity: 0.75,
  },
  // ─── 场景 8：添加加载状态 ───
  {
    id: 'add-loading',
    name: '添加加载状态',
    scene: ['加细节'],
    triggerTags: ['加载', 'loading', '骨架屏', '等待', '白屏'],
    action: '为{{target}}添加加载状态展示',
    spec: `加载状态:
- 骨架屏: 使用 Pulse 动画的灰色占位块
- 旋转指示器: border-brand border-t-transparent rounded-full animate-spin
- 加载文案: "正在加载..."（text-text-tertiary）`,
    constraint: '加载状态必须在数据返回后消失',
    verify: '加载过程中有明确的视觉提示',
    popularity: 0.7,
  },
  // ─── 场景 9：修复对比度 ───
  {
    id: 'fix-contrast',
    name: '提升文字对比度',
    scene: ['修UI'],
    triggerTags: ['看不清', '对比度', '模糊', '文字颜色'],
    action: '提升{{target}}的文字与背景对比度',
    spec: `对比度标准: WCAG AA（≥ 4.5:1）
文字主色: #F0F0F5
文字次要: #A0A0B8
文字辅助: #7B7B92
背景: #0A0A0F`,
    constraint: '确保所有文字颜色符合 WCAG AA 标准',
    verify: '文字与背景对比度 ≥ 4.5:1',
    popularity: 0.78,
  },
  // ─── 场景 10：复制产品特性 ───
  {
    id: 'copy-feature',
    name: '复制产品特性',
    scene: ['复制特性'],
    triggerTags: ['复制', '抄', '参考', '像'],
    action: '参考{{reference}}的{{feature}}特性，应用到当前项目',
    spec: `参考产品: {{reference}}
目标特性: {{feature}}
实现方式: 保持现有技术栈，仅调整样式/交互`,
    constraint: '不得引入新的 npm 依赖，使用项目现有技术栈',
    verify: '实现效果与参考产品视觉一致',
    popularity: 0.85,
  },
];

/**
 * 模板检索器：根据种子输入和意图标签检索最匹配的模板
 */
export class TemplateRetriever {
  private templates: PromptTemplate[];

  constructor(templates: PromptTemplate[] = TEMPLATE_LIBRARY) {
    this.templates = templates;
  }

  /**
   * 检索与查询最匹配的模板
   */
  retrieve(
    seed: string,
    intentTags: IntentTag[] = [],
    history: ContextRecentQA[] = [],
  ): PromptTemplate | null {
    if (!seed || this.templates.length === 0) return null;

    const scored = this.templates.map((template) => ({
      template,
      score: this.scoreTemplate(template, seed, intentTags, history),
    }));

    scored.sort((a, b) => b.score - a.score);

    // 最高分 > 0.15 才返回
    return scored[0].score > 0.15 ? scored[0].template : null;
  }

  /**
   * 检索 Top-K 匹配模板
   */
  retrieveTopK(
    seed: string,
    intentTags: IntentTag[] = [],
    history: ContextRecentQA[] = [],
    k: number = 3,
  ): Array<{ template: PromptTemplate; score: number }> {
    if (!seed || this.templates.length === 0) return [];

    const scored = this.templates.map((template) => ({
      template,
      score: this.scoreTemplate(template, seed, intentTags, history),
    }));

    return scored
      .filter((s) => s.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * 计算模板匹配分数
   */
  private scoreTemplate(
    template: PromptTemplate,
    seed: string,
    intentTags: IntentTag[],
    history: ContextRecentQA[],
  ): number {
    let score = 0;
    const seedLower = seed.toLowerCase();

    // 1. 标签匹配（权重 0.5）
    const tagMatchCount = template.triggerTags.filter((tag) =>
      seedLower.includes(tag.toLowerCase()),
    ).length;
    const tagScore = template.triggerTags.length > 0
      ? tagMatchCount / template.triggerTags.length
      : 0;
    score += tagScore * 0.5;

    // 2. 意图标签匹配（权重 0.3）
    const intentMatchCount = intentTags.filter((t) =>
      template.triggerTags.some((tag) =>
        tag.toLowerCase().includes(t.value.toLowerCase()) ||
        t.value.toLowerCase().includes(tag.toLowerCase()),
      ),
    ).length;
    const intentScore = intentTags.length > 0
      ? intentMatchCount / intentTags.length
      : 0;
    score += intentScore * 0.3;

    // 3. 历史匹配（权重 0.1）
    if (history.length > 0) {
      const historyMatch = history.some((qa) =>
        template.triggerTags.some((tag) =>
          qa.answer.toLowerCase().includes(tag.toLowerCase()),
        ),
      );
      if (historyMatch) score += 0.1;
    }

    // 4. 人气权重（权重 0.1）
    score += template.popularity * 0.1;

    return Math.min(1, score);
  }

  /**
   * 获取所有模板
   */
  getAll(): PromptTemplate[] {
    return this.templates;
  }

  /**
   * 根据 ID 获取模板
   */
  getById(id: string): PromptTemplate | undefined {
    return this.templates.find((t) => t.id === id);
  }
}

export const templateRetriever = new TemplateRetriever();
