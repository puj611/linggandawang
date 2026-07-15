// src/engine/PromptGenerator.ts
// 提示词四段结构拼装器：项目上下文 / 动作段 / 规格段 / 约束段 / 验证段
import type { PromptResult, PromptSegment, MarkdownExportOptions } from '@/types/prompt';
import type { IntentTag } from '@/types/intent-tag';
import type { Answer } from '@/types/state';
import type { ProjectFingerprint } from '@/types/project';
import type { ContextRecentQA, ContextPreference } from '@/types/context';
import type { PromptStage } from './types';
import { STAGE_ORDER } from './types';
import { expandToSpecs } from './EvaluationDict';
import {
  FRAMEWORK_LABELS,
  CSS_LABELS,
  BUILD_LABELS,
  PM_LABELS,
  PROJECT_TYPE_LABELS,
} from '@/lib/tech-rules';

interface GenerateInput {
  intentTags: IntentTag[];
  answers: Record<string, Answer>;
  seedInput: string;
  project?: ProjectFingerprint | null;
  /** v2.0 新增：最近问答历史，用于在动作段中提供连续性 */
  recentQA?: ContextRecentQA[];
  /** v2.0 新增：用户已确认偏好，注入约束段 */
  preferences?: ContextPreference[];
  /** P3 新增：提问模式，quick 模式下 verify 段无答案时自动推断 */
  mode?: 'quick' | 'full';
  /** RAG 新增：向量检索到的相似历史 QA，注入动作段提供跨会话连续性 */
  retrievedContext?: Array<{ question: string; answer: string; score: number }>;
}

/** v1.2 新增：可编辑的段落键名 */
export type SegmentKey = 'action' | 'spec' | 'constraint' | 'verify';

const STAGE_TO_LABEL: Record<string, string> = {
  perceive: '感知',
  name: '命名',
  spec: '规格',
  execute: '执行',
  verify: '验证',
};

export class PromptGenerator {
  /** 从 EngineState 生成 PromptResult */
  generate(input: GenerateInput): PromptResult {
    const { intentTags, answers, seedInput, project, recentQA, preferences, mode, retrievedContext } = input;
    const rawQuotes = this.collectRawQuotes(answers, seedInput, recentQA);
    const projectCtx = project ? this.buildProjectContext(project) : null;
    const action = this.buildAction(intentTags, answers, seedInput, recentQA, retrievedContext);
    const spec = this.buildSpec(intentTags, answers, seedInput, project);
    const constraint = this.buildConstraint(intentTags, answers, project, preferences);
    const verify = this.buildVerify(intentTags, answers, seedInput, mode);
    return {
      project_context: projectCtx,
      action,
      spec,
      constraint,
      verify,
      raw_quotes: rawQuotes,
      intent_tags: [...intentTags],
      generated_at: new Date().toISOString(),
      project: project ?? undefined,
    };
  }

  /** 删除 tag 后重生成（基于剩余 tags + 既有 answers）
   *  v2.0：新增可选 context 参数，保留接口向后兼容
   *  RAG：新增可选 retrievedContext 参数
   */
  regenerate(
    remainingTags: IntentTag[],
    answers: Record<string, Answer>,
    seed: string,
    project?: ProjectFingerprint | null,
    context?: { recentQA?: ContextRecentQA[]; preferences?: ContextPreference[]; retrievedContext?: Array<{ question: string; answer: string; score: number }> },
  ): PromptResult {
    return this.generate({
      intentTags: remainingTags,
      answers,
      seedInput: seed,
      project,
      recentQA: context?.recentQA,
      preferences: context?.preferences,
      retrievedContext: context?.retrievedContext,
    });
  }

  /** v1.2 新增：分块更新某个段落的 content，返回更新后的 PromptResult 副本 */
  updateSection(result: PromptResult, segmentKey: SegmentKey, newContent: string): PromptResult {
    const next: PromptResult = {
      ...result,
      [segmentKey]: {
        ...(result[segmentKey] as PromptSegment),
        content: newContent,
      },
    };
    return next;
  }

  /** 转 Markdown 全文 */
  toMarkdown(result: PromptResult, options: Partial<MarkdownExportOptions> = {}): string {
    const opt: MarkdownExportOptions = {
      include_raw_quotes: true,
      include_tags: true,
      code_block_for_spec: true,
      include_project_context: true,
      ...options,
    };
    const lines: string[] = [];
    lines.push(`# 你的提示词`);
    lines.push('');
    lines.push(`> 生成于 ${result.generated_at}`);
    if (result.project_context && opt.include_project_context) {
      lines.push('');
      lines.push(`> ✨ 已绑定项目「${result.project?.name ?? '项目'}」——提示词将遵循该项目技术栈与约定`);
    }
    lines.push('');

    // 0. 项目上下文段（灵感大王核心差异化）
    if (result.project_context && opt.include_project_context) {
      lines.push(`## 0. 项目上下文（灵感大王自动注入）`);
      lines.push(result.project_context.content);
      lines.push('');
    }

    lines.push(`## 1. 要做什么（动作段）`);
    lines.push(result.action.content);
    if (opt.include_raw_quotes && result.action.raw_quote) {
      lines.push('');
      lines.push(`<!-- 原话：${result.action.raw_quote} -->`);
    }
    lines.push('');
    lines.push(`## 2. 怎么做（规格段）`);
    if (opt.code_block_for_spec) {
      lines.push('```yaml');
      lines.push(result.spec.content);
      lines.push('```');
    } else {
      lines.push(result.spec.content);
    }
    if (opt.include_raw_quotes && result.spec.raw_quote) {
      lines.push(`<!-- 原话：${result.spec.raw_quote} -->`);
    }
    lines.push('');
    lines.push(`## 3. 不能怎么（约束段）`);
    lines.push(result.constraint.content);
    if (opt.include_raw_quotes && result.constraint.raw_quote) {
      lines.push('');
      lines.push(`<!-- 原话：${result.constraint.raw_quote} -->`);
    }
    lines.push('');
    lines.push(`## 4. 怎么算做好了（验证段）`);
    lines.push(result.verify.content);
    if (opt.include_raw_quotes && result.verify.raw_quote) {
      lines.push('');
      lines.push(`<!-- 原话：${result.verify.raw_quote} -->`);
    }
    if (opt.include_tags && result.intent_tags.length > 0) {
      lines.push('');
      lines.push(`---`);
      lines.push('');
      lines.push(`**意图标签清单（${result.intent_tags.length} 个）：**`);
      for (const t of result.intent_tags) {
        lines.push(`- \`${t.label}: ${t.value}\`（来自 ${STAGE_TO_LABEL[t.stage]}阶段）`);
      }
    }
    if (opt.include_raw_quotes && result.raw_quotes.length > 0) {
      lines.push('');
      lines.push(`<!-- 用户原话汇总：`);
      for (const r of result.raw_quotes) {
        lines.push(`  - ${r}`);
      }
      lines.push(`-->`);
    }
    return lines.join('\n');
  }

  /** 导出 .md 文件（浏览器侧用 Blob + download） */
  exportMd(result: PromptResult, filename = 'linggandawang-prompt.md'): void {
    const md = this.toMarkdown(result);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** 复制到剪贴板 */
  async copyToClipboard(result: PromptResult): Promise<boolean> {
    try {
      const md = this.toMarkdown(result);
      await navigator.clipboard.writeText(md);
      return true;
    } catch {
      // fallback
      try {
        const ta = document.createElement('textarea');
        ta.value = this.toMarkdown(result);
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ──────── 段落构建 ────────

  private buildProjectContext(project: ProjectFingerprint): PromptSegment {
    // 核心差异化：把项目指纹转成 AI 能直接遵循的项目上下文指令
    const lines: string[] = [];
    lines.push(`当前项目：${project.name}`);
    lines.push(`项目类型：${PROJECT_TYPE_LABELS[project.project_type] ?? project.project_type}`);

    const techStack: string[] = [];
    if (project.framework) techStack.push(FRAMEWORK_LABELS[project.framework] ?? project.framework);
    if (project.language) {
      techStack.push(project.language === 'typescript' ? 'TypeScript' : 'JavaScript');
    }
    if (project.css_solution) techStack.push(CSS_LABELS[project.css_solution] ?? project.css_solution);
    if (project.build_tool) techStack.push(`${BUILD_LABELS[project.build_tool] ?? project.build_tool} 构建`);
    if (project.package_manager) techStack.push(`包管理：${PM_LABELS[project.package_manager] ?? project.package_manager}`);
    if (techStack.length > 0) {
      lines.push(`技术栈：${techStack.join(' + ')}`);
    }

    if (project.ui_libraries.length > 0) {
      lines.push(`UI 组件库：${project.ui_libraries.join(', ')}（优先使用项目已有组件，不要自行发明新组件）`);
    }
    if (project.state_management.length > 0) {
      lines.push(`状态管理：${project.state_management.join(', ')}（所有状态改动必须使用已有的状态方案）`);
    }

    // 目录约定
    const struct = project.structure;
    const dirMap: Array<[boolean, string, string]> = [
      [struct.has_components, 'components', '新 UI 组件放 src/components/，一个文件一个组件，使用命名导出'],
      [struct.has_hooks, 'hooks', '复用逻辑封装为自定义 Hook 放 src/hooks/，命名以 use 开头'],
      [struct.has_stores, 'stores', '全局状态放 src/stores/，使用现有 store 范式'],
      [struct.has_pages, 'pages/views', '页面级组件放 src/pages 或 src/views/'],
      [struct.has_lib, 'lib/utils', '纯工具函数放 src/lib 或 src/utils/'],
      [struct.has_types, 'types', '类型定义放 src/types/，使用 `export interface`'],
      [struct.has_assets, 'assets', '图片/字体等静态资源放 src/assets/'],
      [struct.has_tests, 'tests', '测试用例放在 __tests__ 目录或与源文件同目录的 *.test.ts(x)'],
    ];
    const presentDirs = dirMap.filter(([has]) => has);
    if (presentDirs.length > 0) {
      lines.push('目录约定：');
      for (const [, dir, rule] of presentDirs) {
        lines.push(`  - src/${dir}/：${rule}`);
      }
    }

    // 自动识别的约定
    if (project.conventions.length > 0) {
      lines.push('项目已识别约定（必须严格遵守）：');
      for (const c of project.conventions) {
        lines.push(`  - ${c}`);
      }
    }

    lines.push('');
    lines.push('—— 以上上下文由灵感大王扫描项目自动注入，后续输出必须严格遵循。不得违反上述技术栈/目录/约定引入新方案，不得建议或使用项目未采用的库或模式。');

    return {
      title: '项目上下文',
      content: lines.join('\n'),
    };
  }

  private buildAction(
    tags: IntentTag[],
    answers: Record<string, Answer>,
    seed: string,
    recentQA?: ContextRecentQA[],
    retrievedContext?: Array<{ question: string; answer: string; score: number }>,
  ): PromptSegment {
    // 动作段：从 seed + perceive 回答提取动词 + 对象
    const perceiveAnswers = this.answersByStage(answers, 'perceive');
    const sceneTag = tags.find((t) => t.label === '场景');
    const targetTag = tags.find(
      (t) => t.label === '目标' || t.label === '维度',
    );

    let action = '';
    if (sceneTag?.value === '修UI') {
      action = `将${targetTag?.value ?? '目标 UI 元素'}按以下规格调整`;
    } else if (sceneTag?.value === '加细节') {
      action = `给${targetTag?.value ?? '现有功能'}加入以下细节`;
    } else if (sceneTag?.value === '复制特性') {
      action = `参考${targetTag?.value ?? '其他产品'}复制以下特性`;
    } else if (seed) {
      action = `完成以下需求：${seed}`;
    } else {
      action = `按以下规格调整 UI`;
    }

    // v2.0：若有最近问答历史，附加连续性提示（仅引用最后一条作为衔接）
    const lastQA = recentQA?.[recentQA.length - 1];
    if (lastQA && lastQA.answer && lastQA.answer !== '__skipped__') {
      const tail = `\n（衔接上文：${lastQA.question_text} → ${lastQA.answer}）`;
      action = action + tail;
    }

    // RAG 新增：注入向量检索到的相似历史 QA（提供跨会话连续性）
    if (retrievedContext && retrievedContext.length > 0) {
      const historyLines = retrievedContext
        .filter((h) => h.score > 0.4) // 仅保留高相似度的
        .slice(0, 3) // 最多 3 条
        .map((h) => `  - ${h.question} → ${h.answer}（相似度 ${(h.score * 100).toFixed(0)}%）`);
      if (historyLines.length > 0) {
        action += `\n\n历史上相似的需求处理方式：\n${historyLines.join('\n')}`;
      }
    }

    const raw = perceiveAnswers.map((a) => a.raw).filter(Boolean).join(' / ');
    return {
      title: '要做什么',
      content: action,
      raw_quote: raw || undefined,
    };
  }

  private buildSpec(tags: IntentTag[], answers: Record<string, Answer>, seed: string, project?: ProjectFingerprint | null): PromptSegment {
    // 规格段：从 spec 阶段回答 + 评价词典展开
    const specAnswers = this.answersByStage(answers, 'spec');
    const lines: string[] = [];

    // 项目自动注入默认规格
    if (project) {
      const projectInjected: string[] = [];
      if (project.css_solution === 'tailwind') {
        projectInjected.push('样式方案：使用 Tailwind CSS 原子类，不得写内联 style 或新增 CSS 文件');
      } else if (project.css_solution === 'css-modules') {
        projectInjected.push('样式方案：使用 CSS Modules（*.module.css），类名使用 camelCase');
      } else if (project.css_solution === 'styled-components') {
        projectInjected.push('样式方案：使用 styled-components，组件命名 PascalCase');
      } else if (project.css_solution === 'emotion') {
        projectInjected.push('样式方案：使用 Emotion（@emotion/react）CSS-in-JS');
      }
      if (project.framework === 'react' && project.language === 'typescript') {
        projectInjected.push('语言规范：TypeScript + React 函数组件，使用 FC<Props> 或直接声明 props 类型');
      }
      if (project.ui_libraries.includes('shadcn/ui')) {
        projectInjected.push('组件库：使用 shadcn/ui 组件，导入路径 @/components/ui/xxx；不足时在 src/components/ui/ 下通过 shadcn 命令添加');
      } else if (project.ui_libraries.includes('antd')) {
        projectInjected.push('组件库：优先使用 Ant Design 已有组件');
      } else if (project.ui_libraries.includes('@mui/material') || project.ui_libraries.includes('mui')) {
        projectInjected.push('组件库：优先使用 MUI 组件');
      }
      for (const s of projectInjected) lines.push(s);
    }

    // 1. spec 阶段的标签 → key: value 行
    const specTags = tags.filter((t) => t.stage === 'spec');
    for (const t of specTags) {
      lines.push(`${t.label}: ${t.value}`);
    }

    // 2. spec 阶段的自定义回答 raw
    for (const a of specAnswers) {
      if (a.skipped || !a.raw) continue;
      if (a.value === a.raw) continue; // 已被选项 tags 覆盖
      lines.push(`自定义规格: ${a.raw}`);
    }

    // 3. 评价词典展开（seed + perceive/name raw 中的"太挤/太丑"等）
    const allText = [seed, ...Object.values(answers).map((a) => a.raw)].join(' ');
    const expandedSpecs = expandToSpecs(allText);
    for (const s of expandedSpecs) {
      if (!lines.some((l) => l.includes(s.slice(0, 10)))) {
        lines.push(s);
      }
    }

    const content = lines.length > 0 ? lines.join('\n') : '（请补充具体规格：间距/圆角/字号/配色等数值）';
    const raw = specAnswers.map((a) => a.raw).filter(Boolean).join(' / ');
    return {
      title: '怎么做',
      content,
      raw_quote: raw || undefined,
    };
  }

  private buildConstraint(
    tags: IntentTag[],
    answers: Record<string, Answer>,
    project?: ProjectFingerprint | null,
    preferences?: ContextPreference[],
  ): PromptSegment {
    // 约束段：从 verify 阶段回答 + 标签推导否定式约束
    const verifyAnswers = this.answersByStage(answers, 'verify');
    const executeAnswers = this.answersByStage(answers, 'execute');
    const lines: string[] = [];

    // 项目自动注入约束（硬红线）
    if (project) {
      lines.push(`不得引入 package.json 中不存在的 npm 依赖`);
      if (project.package_manager) {
        const pm = project.package_manager;
        if (pm === 'pnpm') lines.push('使用 pnpm 安装依赖，不要用 npm/yarn');
        if (pm === 'yarn') lines.push('使用 yarn 安装依赖，不要用 npm/pnpm');
      }
      if (project.css_solution === 'tailwind') {
        lines.push('不得写独立 .css/.scss/.less 文件，所有样式通过 Tailwind 类实现；如需扩展使用 tailwind.config.ts');
      }
      if (project.framework === 'react') {
        lines.push('必须使用 React 函数组件 + Hooks，禁止 class 组件');
      }
      if (project.language === 'typescript') {
        lines.push('不得使用 any 类型，必须为所有 props/state 定义明确类型');
      }
      if (project.framework === 'next') {
        lines.push("注意 Next.js App Router 约定：'use client'/'use server' 标注正确，组件放对位置");
      }
    }

    // 从 execute 回答推导
    const respTag = tags.find((t) => t.label === '响应式');
    if (respTag) {
      if (respTag.value === '桌面优先，移动端自适应') lines.push('不得破坏移动端自适应');
      if (respTag.value === '移动优先，桌面端扩展') lines.push('保持移动优先的断点顺序');
      if (respTag.value === '仅桌面端，不响应式') lines.push('不需要响应式处理');
    }
    const themeTag = tags.find((t) => t.label === '主题');
    if (themeTag) {
      if (themeTag.value === '仅深色') lines.push('不需要支持浅色主题');
      if (themeTag.value === '仅浅色') lines.push('不需要支持深色主题');
      if (themeTag.value === '双主题') lines.push('必须同时支持深色/浅色主题切换');
    }
    const impactTag = tags.find((t) => t.label === '影响');
    if (impactTag?.value === '纯视觉，不影响逻辑') lines.push('不得改动任何交互逻辑代码');
    if (impactTag?.value === '需要调整交互边界') lines.push('不得破坏现有交互逻辑的边界');

    // 通用否定式约束
    lines.push('不要使用"现代化、美观、流畅"等空话，必须给出可量化规格');
    if (!project) lines.push('不得引入新的 npm 依赖');

    // verify 回答中的回退策略作为约束
    for (const a of verifyAnswers) {
      if (a.value === 'revert') lines.push('未达标时使用 git revert 回退');
      if (a.value === 'comment') lines.push('未达标时注释保留改动');
    }

    // v2.0 新增：用户已确认偏好（来自历史累积）作为正向约束
    if (preferences && preferences.length > 0) {
      lines.push('');
      lines.push('用户已确认偏好（必须遵循）：');
      for (const p of preferences) {
        lines.push(`  - ${p.key}: ${p.value}`);
      }
    }

    const raw = [...executeAnswers, ...verifyAnswers].map((a) => a.raw).filter(Boolean).join(' / ');
    return {
      title: '不能怎么',
      content: lines.join('\n'),
      raw_quote: raw || undefined,
    };
  }

  private buildVerify(
    tags: IntentTag[],
    answers: Record<string, Answer>,
    seedInput: string,
    mode?: 'quick' | 'full',
  ): PromptSegment {
    // 验证段：从 verify 阶段回答生成可观测条件
    const verifyAnswers = this.answersByStage(answers, 'verify');
    const lines: string[] = [];

    const methodTag = tags.find((t) => t.label === '验证');
    if (methodTag) {
      if (methodTag.value === '截图对比前后') lines.push('截图对比改动前后视觉效果');
      if (methodTag.value === '肉眼对照参考产品') lines.push('肉眼对照参考产品逐项核对');
      if (methodTag.value === '走查清单逐项打勾') lines.push('走查清单逐项打勾验收');
    }

    const stdTag = tags.find((t) => t.label === '验证标准');
    if (stdTag) {
      lines.push(`客观标准：${stdTag.value}`);
    }

    // 对比度约束
    const contrastTag = tags.find((t) => t.label === '对比度');
    if (contrastTag) {
      lines.push(`文字与背景对比度 ≥ ${contrastTag.value.includes('AAA') ? '7.0' : '4.5'}:1`);
    }

    // 间距约束
    const layoutTag = tags.find((t) => t.label === '布局');
    if (layoutTag) {
      const padding = tags.find((t) => t.label === '内边距');
      if (padding) lines.push(`内边距实测值 = ${padding.value}`);
    }

    // P3 增强：quick 模式下若 verify 段无答案，基于种子推断验证标准
    // 避免空泛的"肉眼确认"，给 AI 可执行的验证条件
    if (lines.length === 0 && mode === 'quick' && seedInput) {
      lines.push(...this.inferVerifyFromSeed(seedInput));
    }

    if (lines.length === 0) {
      lines.push('改动后截图，肉眼确认符合上述规格段全部数值');
    }

    const raw = verifyAnswers.map((a) => a.raw).filter(Boolean).join(' / ');
    return {
      title: '怎么算做好了',
      content: lines.join('\n'),
      raw_quote: raw || undefined,
    };
  }

  /** P3 新增：quick 模式下基于种子推断验证标准 */
  private inferVerifyFromSeed(seed: string): string[] {
    const lines: string[] = [];
    const lower = seed.toLowerCase();

    // 通用基础验证
    lines.push('代码可通过编译/构建（无 TypeScript 错误）');

    // 基于关键词推断具体验证标准
    if (/间距|padding|margin|留白/.test(seed)) {
      lines.push('间距实测值符合规格段要求（偏差 ≤ 2px）');
    }
    if (/颜色|配色|对比|color|contrast/.test(lower)) {
      lines.push('文字与背景对比度 ≥ 4.5:1（WCAG AA）');
    }
    if (/圆角|radius/.test(lower)) {
      lines.push('圆角实测值符合规格段要求');
    }
    if (/字号|字体|font/.test(lower)) {
      lines.push('字号实测值符合规格段要求');
    }
    if (/响应|移动|mobile|responsive/.test(lower)) {
      lines.push('移动端/桌面端布局均不溢出');
    }
    if (/动画|过渡|animation|transition/.test(lower)) {
      lines.push('动画过渡平滑，无明显卡顿');
    }

    // 通用功能验证
    lines.push('主要功能可正常运行（点击/输入/跳转无报错）');

    return lines;
  }

  // ──────── 工具方法 ────────

  private answersByStage(answers: Record<string, Answer>, stage: PromptStage): Answer[] {
    return Object.values(answers).filter((a) => {
      // 通过 questionId 前缀判断阶段
      const prefix = a.questionId.charAt(0);
      const stagePrefix: Record<PromptStage, string> = {
        perceive: 'p',
        name: 'n',
        spec: 's',
        execute: 'e',
        verify: 'v',
      };
      return prefix === stagePrefix[stage];
    });
  }

  private collectRawQuotes(
    answers: Record<string, Answer>,
    seed: string,
    recentQA?: ContextRecentQA[],
  ): string[] {
    const quotes: string[] = [];
    if (seed) quotes.push(seed);
    // v2.0：把最近问答历史的答案也纳入原话汇总（提供更完整的上下文）
    if (recentQA && recentQA.length > 0) {
      for (const qa of recentQA) {
        if (qa.answer && qa.answer !== '__skipped__') {
          quotes.push(`[历史] ${qa.question_text} → ${qa.answer}`);
        }
      }
    }
    for (const stage of STAGE_ORDER) {
      const list = this.answersByStage(answers, stage);
      for (const a of list) {
        if (a.raw && a.raw !== '__skipped__') quotes.push(a.raw);
      }
    }
    return quotes;
  }
}

export const promptGenerator = new PromptGenerator();
