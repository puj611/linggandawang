// src/engine/seedRouter.ts
// 种子输入路由 v1.2：在 v1.1 关键词路由基础上，新增形容词簇匹配 + 权重聚合 + 动态澄清问题 + 多场景路由
// 行为契约：
//   1. 先检测 seed 属于哪个场景（frontend-ui / backend-api），默认 frontend-ui
//   2. 原有 keyword 路由优先命中 preferredQuestionId 时直接返回（向后兼容）
//   3. 否则基于形容词簇做权重聚合：返回 tagScores 让 Selector 选下一题
//   4. 若命中簇且该簇有 clarification_question，返回动态澄清题
//   5. 旧接口字段（question / matchedKeywords）保持不变，新增 scene 字段
import type { Question, QuestionOption, ClusterMatch, TagScore, ClusterTagWeight } from './types';
import type { QuestionLoader } from './QuestionLoader';
import { getAllAdjectiveClusters } from './AdjectiveClusterLoader';

/** 支持的场景类型 */
export type SceneType = 'frontend-ui' | 'backend-api';

interface SeedRoute {
  keywords: string[];
  targetStage: 'perceive' | 'name' | 'spec';
  preferredQuestionId?: string;
  /** 该路由适用的场景（默认 frontend-ui） */
  scene?: SceneType;
}

// 后端关键词（命中任一即判定为后端场景）
const BACKEND_KEYWORDS = [
  '接口', 'api', '后端', '数据库', 'sql', '查询', '缓存',
  'redis', 'mysql', 'mongo', 'postgres', 'orm',
  'jwt', 'session', 'oauth', '认证', '鉴权',
  '分页', '错误码', '数据模型', '表结构', '迁移',
  'node', 'python', 'golang', 'rust', 'java', 'spring',
  'docker', 'k8s', 'serverless', '部署',
  'mq', '队列', '消息', '微服务', 'grpc', 'graphql', 'restful',
];

// 前端关键词（命中任一即判定为前端场景）
const FRONTEND_KEYWORDS = [
  '页面', '按钮', '颜色', '布局', '样式', 'ui',
  '间距', '圆角', '字体', '字号', '配色', '对齐',
  '阴影', '动画', '动效', '深色', '浅色', '响应式',
  '卡片', '导航', '表单', '弹窗', '组件', 'hover',
];

// 按场景/痛点关键词路由（具体关键词优先，"改/修"等通用词放最后）
const ROUTES: SeedRoute[] = [
  // 圆角 → spec s-002（具体关键词优先）
  { keywords: ['圆角', '弧度'], targetStage: 'spec', preferredQuestionId: 's-002' },
  // 配色 → spec s-005
  { keywords: ['配色', '颜色', '主色'], targetStage: 'spec', preferredQuestionId: 's-005' },
  // 对比度 → spec s-006
  { keywords: ['对比度', '对比'], targetStage: 'spec', preferredQuestionId: 's-006' },
  // 字号 → spec s-004
  { keywords: ['字号', '字体大小'], targetStage: 'spec', preferredQuestionId: 's-004' },
  // 乱 → 直接进 name 阶段 n-001
  { keywords: ['乱'], targetStage: 'name', preferredQuestionId: 'n-001' },
  // 丑 → name 阶段 n-002
  { keywords: ['丑'], targetStage: 'name', preferredQuestionId: 'n-002' },
  // 不够高级 → name 阶段 n-003
  { keywords: ['高级', '质感', '精致'], targetStage: 'name', preferredQuestionId: 'n-003' },
  // 看不清 → name 阶段 n-004
  { keywords: ['看不清', '模糊', '不清'], targetStage: 'name', preferredQuestionId: 'n-004' },
  // 呆板 → name 阶段 n-005
  { keywords: ['呆板', '死板', '动效'], targetStage: 'name', preferredQuestionId: 'n-005' },
  // 不统一 → name 阶段 n-006
  { keywords: ['不统一', '不一致', '不整齐', '不规整'], targetStage: 'name', preferredQuestionId: 'n-006' },
  // 整体风格切换 → name 阶段 n-007（风格方向选择）
  // 注意："风格"是高频且宽泛的词，不能落到"不统一"这类"抱怨型"问题上；必须走风格方向题
  {
    keywords: ['风格', '换风格', '改风格', '调整风格', '整体风格', '视觉风格', 'ui风格', '前端风格', '改版', '重做', '换个样子', '重新设计', 'redesign', '整体改'],
    targetStage: 'name',
    preferredQuestionId: 'n-007',
  },
  // 太挤/间距 → perceive p-001 起步，标签会驱动后续选题
  { keywords: ['挤', '间距', '密'], targetStage: 'perceive', preferredQuestionId: 'p-001' },
  // 修 UI → perceive p-001（"修一个看不顺眼的 UI"），通用关键词放最后
  { keywords: ['修', '改', '调', 'fix'], targetStage: 'perceive', preferredQuestionId: 'p-001' },

  // ───────── 后端场景路由（scene: backend-api）─────────
  // 接口路径风格 → name b-005
  { keywords: ['restful', 'rpc风格', 'graphql端点', 'grpc接口'], targetStage: 'name', preferredQuestionId: 'b-005', scene: 'backend-api' },
  // 数据存储 → name b-006
  { keywords: ['存储选型', '用什么数据库', 'redis缓存', 'mongo文档'], targetStage: 'name', preferredQuestionId: 'b-006', scene: 'backend-api' },
  // 业务逻辑复杂度 → name b-007
  { keywords: ['状态机', '工作流', '分布式事务', '业务规则'], targetStage: 'name', preferredQuestionId: 'b-007', scene: 'backend-api' },
  // 数据模型 → name b-009
  { keywords: ['数据模型', '表结构', '建表', '实体关系'], targetStage: 'name', preferredQuestionId: 'b-009', scene: 'backend-api' },
  // 认证方式 → spec b-013
  { keywords: ['jwt', '认证方式', 'oauth', 'session登录', 'api-key'], targetStage: 'spec', preferredQuestionId: 'b-013', scene: 'backend-api' },
  // 分页 → spec b-012
  { keywords: ['分页', 'cursor游标', 'offset-limit', '排序约定'], targetStage: 'spec', preferredQuestionId: 'b-012', scene: 'backend-api' },
  // 错误码 → spec b-011
  { keywords: ['错误码', '错误处理', 'http状态码', '业务码'], targetStage: 'spec', preferredQuestionId: 'b-011', scene: 'backend-api' },
  // 技术栈 → execute b-016
  { keywords: ['技术栈', '用什么语言', 'nodejs', 'fastapi', 'gin框架'], targetStage: 'spec', preferredQuestionId: 'b-016', scene: 'backend-api' },
  // 新增接口 → perceive b-001（后端通用入口）
  { keywords: ['新增接口', '写个api', '加个接口', '后端开发'], targetStage: 'perceive', preferredQuestionId: 'b-001', scene: 'backend-api' },
];

/**
 * 根据 seed 关键词检测场景（P1.1 新增）。
 * 后端关键词命中数 > 前端关键词命中数 → backend-api
 * 否则 → frontend-ui（默认）
 */
export function detectScene(seed: string): SceneType {
  if (!seed) return 'frontend-ui';
  const lowered = seed.toLowerCase();
  let backendHits = 0;
  let frontendHits = 0;
  for (const kw of BACKEND_KEYWORDS) {
    if (lowered.includes(kw.toLowerCase())) backendHits++;
  }
  for (const kw of FRONTEND_KEYWORDS) {
    if (lowered.includes(kw.toLowerCase())) frontendHits++;
  }
  // 后端命中严格大于前端才判定为后端，否则默认前端
  return backendHits > frontendHits ? 'backend-api' : 'frontend-ui';
}

/**
 * 在文本中匹配所有形容词簇，返回去重后的命中列表。
 * 同一 cluster 命中多个 surface_form 时只算一次（取首次匹配的位置/形式）。
 */
export function matchAdjectiveClusters(text: string): ClusterMatch[] {
  if (!text) return [];
  const lowered = text.toLowerCase();
  const clusters = getAllAdjectiveClusters();
  const result: ClusterMatch[] = [];
  for (const cluster of clusters) {
    for (const form of cluster.surface_forms) {
      if (lowered.includes(form.toLowerCase())) {
        result.push({
          cluster,
          matched_form: form,
          magnitude: cluster.magnitude_modifier ?? 1,
        });
        break; // 每个簇只计一次命中
      }
    }
  }
  return result;
}

/**
 * 把簇命中按 dimension_tags 聚合为 TagScore 数组。
 * 同一 tag 来自多个簇时权重累加。cluster.magnitude 会乘到它产出的所有 tag 权重上。
 */
export function aggregateTagScores(matches: ClusterMatch[]): TagScore[] {
  const map = new Map<string, TagScore>();
  for (const m of matches) {
    for (const t of m.cluster.dimension_tags) {
      const w = t.weight * m.magnitude;
      const existing = map.get(t.tag);
      if (existing) {
        existing.weight = round2(existing.weight + w);
        if (!existing.source_clusters.includes(m.cluster.id)) {
          existing.source_clusters.push(m.cluster.id);
        }
      } else {
        map.set(t.tag, {
          tag: t.tag,
          weight: round2(w),
          source_clusters: [m.cluster.id],
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.weight - a.weight);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 取最高的 N 个 TagScore */
export function topTagScores(scores: TagScore[], n: number): TagScore[] {
  return scores.slice(0, Math.max(0, n));
}

/**
 * 根据最高得分的簇生成动态澄清题。
 * 当 score > 0 的 tag 数量 > 1，且该 tag 来自同一个簇的 clarification_options 时返回。
 */
export function buildDynamicClarification(
  originalSeed: string,
  scores: TagScore[],
  matches: ClusterMatch[],
): Question | null {
  if (matches.length === 0) return null;
  // 找带澄清配置的最高权重簇
  const candidate = matches.find(
    (m) =>
      m.cluster.clarification_question &&
      Array.isArray(m.cluster.clarification_options) &&
      m.cluster.clarification_options.length > 0,
  );
  if (!candidate) return null;
  // 仅在该簇的 dimension_tags 中至少 2 个不同 tag 命中时才生成澄清（避免无谓的追问）
  const clusterTags = new Set(candidate.cluster.dimension_tags.map((t: ClusterTagWeight) => t.tag));
  const hitCount = scores.filter((s) => clusterTags.has(s.tag)).length;
  if (hitCount < 2 && matches.length < 2) return null;
  const opts: QuestionOption[] = candidate.cluster.clarification_options!.map((o, i) => ({
    label: o.label,
    value: `clarify-${candidate.cluster.id}-${i}`,
    tags: [o.target_tag],
  }));
  return {
    id: `dyn-clarify-${candidate.cluster.id}`,
    stage: 'name',
    order: 0,
    text: candidate.cluster.clarification_question!.replace(/\{seed\}/g, originalSeed || ''),
    type: 'single-choice',
    options: opts,
    allow_custom: true,
    placeholder: '或自己描述...',
    trigger_tags: opts.flatMap((o) => o.tags),
    jumps: [],
    intent_extraction: { keywords: [] },
    required: true,
  };
}

/**
 * 旧版兼容：仅返回首问题，不返回簇/标签/澄清。
 * 新代码请使用 routeSeedWithClusters。
 */
export function routeSeed(loader: QuestionLoader, seed: string): {
  question: Question | null;
  matchedKeywords: string[];
} {
  return routeSeedWithClusters(loader, seed);
}

/**
 * 完整版路由：场景检测 → 关键词优先 → 形容词簇匹配 → 聚合 → 必要时生成澄清题。
 * P1.1：新增 scene 字段，根据 seed 关键词自动判定 frontend-ui / backend-api 场景。
 */
export function routeSeedWithClusters(loader: QuestionLoader, seed: string) {
  const text = seed.trim();
  if (!text) {
    return { question: null, matchedKeywords: [], matchedClusters: [], tagScores: [], scene: 'frontend-ui' as SceneType };
  }
  const lowered = text.toLowerCase();

  // 0. 场景检测（P1.1 新增）
  const scene = detectScene(text);
  // 切换 loader 到对应场景，使后续 getQuestionById / getBank 取到正确场景的问题库
  loader.setScene(scene);

  // 1. 关键词路由（按场景过滤：前端 seed 只走前端路由，后端 seed 只走后端路由）
  const sceneRoutes = ROUTES.filter((r) => {
    if (scene === 'backend-api') return r.scene === 'backend-api';
    // frontend-ui：走未标记 scene 的路由（即前端路由）
    return !r.scene || r.scene === 'frontend-ui';
  });
  const matched: string[] = [];
  for (const route of sceneRoutes) {
    for (const kw of route.keywords) {
      if (lowered.includes(kw.toLowerCase())) {
        matched.push(kw);
        if (route.preferredQuestionId) {
          const q = loader.getQuestionById(route.preferredQuestionId);
          if (q) {
            return {
              question: q,
              matchedKeywords: matched,
              matchedClusters: [],
              tagScores: [],
              scene,
            };
          }
        }
      }
    }
  }

  // 2. 形容词簇匹配 + 权重聚合
  const matchedClusters = matchAdjectiveClusters(text);
  const tagScores = aggregateTagScores(matchedClusters);
  // 3. 必要时生成动态澄清题
  const dynamicClarification = buildDynamicClarification(seed, tagScores, matchedClusters);

  return {
    question: dynamicClarification, // 若生成了澄清题，则用其作为首问题
    matchedKeywords: matched,
    matchedClusters,
    tagScores,
    dynamicClarification: dynamicClarification ?? undefined,
    scene,
  };
}

/**
 * 为 QuestionEngine 使用的轻量工厂：根据 tagScores + matchedClusters 选首问题。
 * 优先级：trigger_clusters 命中 > trigger_tags 命中 > 兜底 order。
 */
export function pickFirstQuestionByTagScores(
  loader: QuestionLoader,
  scores: TagScore[],
  matchedClusters: ClusterMatch[] = [],
): Question | null {
  const top = scores[0]?.tag;
  const clusterIds = new Set(matchedClusters.map((m) => m.cluster.id));

  // 1. name 阶段、trigger_clusters 命中任意一个
  const nameByCluster = loader
    .getBank()
    .questions.filter(
      (q) =>
        q.stage === 'name' &&
        (q.trigger_clusters ?? []).some((c) => clusterIds.has(c)),
    );
  if (nameByCluster.length > 0) {
    // 同 cluster 命中数最多优先，再按 tagScores 命中 trigger_tags
    nameByCluster.sort((a, b) => {
      const aHit = (a.trigger_clusters ?? []).filter((c) => clusterIds.has(c)).length;
      const bHit = (b.trigger_clusters ?? []).filter((c) => clusterIds.has(c)).length;
      if (aHit !== bHit) return bHit - aHit;
      const aTagHit = a.trigger_tags.includes(top) ? 1 : 0;
      const bTagHit = b.trigger_tags.includes(top) ? 1 : 0;
      if (aTagHit !== bTagHit) return bTagHit - aTagHit;
      return a.order - b.order;
    });
    return nameByCluster[0];
  }

  // 2. name 阶段、trigger_tags 命中 top
  if (top) {
    const nameQs = loader
      .getBank()
      .questions.filter((q) => q.stage === 'name' && q.trigger_tags.includes(top));
    if (nameQs.length > 0) return nameQs.sort((a, b) => a.order - b.order)[0];
  }

  // 3. spec 阶段、trigger_clusters 命中
  const specByCluster = loader
    .getBank()
    .questions.filter(
      (q) =>
        q.stage === 'spec' &&
        (q.trigger_clusters ?? []).some((c) => clusterIds.has(c)),
    );
  if (specByCluster.length > 0) {
    specByCluster.sort((a, b) => {
      const aHit = (a.trigger_clusters ?? []).filter((c) => clusterIds.has(c)).length;
      const bHit = (b.trigger_clusters ?? []).filter((c) => clusterIds.has(c)).length;
      if (aHit !== bHit) return bHit - aHit;
      return a.order - b.order;
    });
    return specByCluster[0];
  }

  return null;
}
