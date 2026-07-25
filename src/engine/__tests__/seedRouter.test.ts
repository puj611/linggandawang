// src/engine/__tests__/seedRouter.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  detectNegation,
  detectScene,
  detectSceneWithChoice,
  matchAdjectiveClusters,
  aggregateTagScores,
  routeSeedWithClusters,
} from '../seedRouter';
import { QuestionLoader } from '../QuestionLoader';

// Mock AdjectiveClusterLoader
vi.mock('../AdjectiveClusterLoader', () => ({
  getAllAdjectiveClusters: () => [
    {
      id: 'c-乱',
      surface_forms: ['乱', '杂乱', '混乱'],
      dimension_tags: [
        { tag: '维度: 间距不统一', weight: 0.6 },
        { tag: '维度: 配色不统一', weight: 0.4 },
      ],
      magnitude_modifier: 1,
    },
    {
      id: 'c-丑',
      surface_forms: ['丑', '难看', '不好看'],
      dimension_tags: [
        { tag: '维度: 配色', weight: 0.5 },
        { tag: '维度: 圆角描边', weight: 0.3 },
      ],
      magnitude_modifier: 1,
    },
    {
      id: 'c-高级',
      surface_forms: ['高级', '质感', '精致'],
      dimension_tags: [
        { tag: '维度: 留白不足', weight: 0.4 },
        { tag: '维度: 配色', weight: 0.3 },
      ],
      magnitude_modifier: 1.2,
    },
    {
      id: 'c-呆板',
      surface_forms: ['呆板', '死板'],
      dimension_tags: [
        { tag: '维度: 缺动效', weight: 0.8 },
      ],
      magnitude_modifier: 1,
    },
  ],
}));

describe('seedRouter', () => {
  describe('detectNegation', () => {
    it('空字符串返回空数组', () => {
      expect(detectNegation('')).toEqual([]);
    });

    it('无否定词返回空数组', () => {
      expect(detectNegation('按钮太丑了')).toEqual([]);
    });

    it('检测"不要"后的否定目标', () => {
      const result = detectNegation('不要圆角');
      expect(result).toContain('圆角');
    });

    it('检测"别"后的否定目标', () => {
      const result = detectNegation('别用阴影');
      // detectNegation takes 2-3 chars after negation word
      expect(result.length).toBeGreaterThan(0);
    });

    it('检测"不需要"后的否定目标', () => {
      const result = detectNegation('不需要阴影');
      expect(result).toContain('阴影');
    });

    it('检测反向语序"X不要"', () => {
      const result = detectNegation('圆角不要');
      expect(result).toContain('圆角');
    });

    it('检测英文否定词', () => {
      const result = detectNegation('no shadow please');
      expect(result).toContain('shadow');
    });

    it('多个否定词都能检测', () => {
      const result = detectNegation('不要圆角，别用阴影');
      expect(result).toContain('圆角');
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('detectScene', () => {
    it('空字符串返回 frontend-ui', () => {
      expect(detectScene('')).toBe('frontend-ui');
    });

    it('前端关键词命中返回 frontend-ui', () => {
      expect(detectScene('按钮颜色不好看')).toBe('frontend-ui');
    });

    it('后端关键词命中返回 backend-api', () => {
      expect(detectScene('新增一个 RESTful 接口')).toBe('backend-api');
    });

    it('混合关键词时后端严格大于前端才判定为后端', () => {
      // "页面上的API接口" has 2 backend hits (api, 接口) and 1 frontend hit (页面)
      // backendHits (2) > frontendHits (1), so returns backend-api
      const result = detectScene('页面上的API接口');
      expect(result).toBe('backend-api');
    });

    // 三模式系统：PPT 场景测试
    it('PPT 关键词命中返回 ppt', () => {
      expect(detectScene('改 PPT')).toBe('ppt');
      expect(detectScene('做一个 pptx 演示文稿')).toBe('ppt');
      expect(detectScene('修改 keynote 幻灯片')).toBe('ppt');
    });

    it('文档/邮件/文案关键词不再判定为专属场景，返回默认 frontend-ui', () => {
      // 三模式系统：文档/邮件/文案/图片/视频关键词不再属于任何专属场景
      // 用户如需 PPT 场景，需手动选择 PPT 模式或描述中包含 PPT 关键词
      expect(detectScene('写一份 word 文档')).toBe('frontend-ui');
      expect(detectScene('起草一封邮件')).toBe('frontend-ui');
      expect(detectScene('写广告语文案')).toBe('frontend-ui');
    });

    it('图片/视频/海报关键词不再判定为专属场景，返回默认 frontend-ui', () => {
      expect(detectScene('设计一个 logo')).toBe('frontend-ui');
      expect(detectScene('做个海报')).toBe('frontend-ui');
      expect(detectScene('写视频脚本')).toBe('frontend-ui');
    });

    it('ppt 场景下 routeSeedWithClusters 返回 ppt 场景并命中 PPT 路由', () => {
      const loader = new QuestionLoader();
      const result = routeSeedWithClusters(loader, '改 PPT');
      expect(result.scene).toBe('ppt');
      // 三模式系统：PPT 现在有专属路由，应命中通用 PPT 入口
      expect(result.matchedKeywords).toContain('ppt');
      expect(result.question?.id).toBe('o-001');
    });

    it('前端关键词与 PPT 关键词混合时优先前端（保持向后兼容）', () => {
      // "改 PPT 的按钮颜色" 同时命中前端（按钮/颜色）和 PPT（PPT）
      // 应判定为 frontend-ui，保持向后兼容
      expect(detectScene('改 PPT 的按钮颜色')).toBe('frontend-ui');
    });

    // 三模式系统：detectSceneWithChoice 测试
    it('detectSceneWithChoice 非 auto 时强制返回用户选择的场景', () => {
      expect(detectSceneWithChoice('改 PPT', 'frontend-ui')).toBe('frontend-ui');
      expect(detectSceneWithChoice('按钮颜色', 'ppt')).toBe('ppt');
      expect(detectSceneWithChoice('新增接口', 'backend-api')).toBe('backend-api');
    });

    it('detectSceneWithChoice auto 时走 detectScene 关键词检测', () => {
      expect(detectSceneWithChoice('改 PPT', 'auto')).toBe('ppt');
      expect(detectSceneWithChoice('按钮颜色', 'auto')).toBe('frontend-ui');
      expect(detectSceneWithChoice('新增 RESTful 接口', 'auto')).toBe('backend-api');
    });

    // 三模式系统：forcedScene 参数测试
    it('routeSeedWithClusters forcedScene 强制覆盖关键词检测', () => {
      const loader = new QuestionLoader();
      // "按钮颜色"正常检测为 frontend-ui，但 forcedScene='ppt' 时强制走 ppt
      const result = routeSeedWithClusters(loader, '按钮颜色', 'ppt');
      expect(result.scene).toBe('ppt');
    });

    it('routeSeedWithClusters forcedScene=null 时走 detectScene', () => {
      const loader = new QuestionLoader();
      const result = routeSeedWithClusters(loader, '按钮颜色', null);
      expect(result.scene).toBe('frontend-ui');
    });
  });

  describe('matchAdjectiveClusters', () => {
    it('空文本返回空数组', () => {
      expect(matchAdjectiveClusters('')).toEqual([]);
    });

    it('匹配"乱"相关簇', () => {
      const result = matchAdjectiveClusters('页面太乱了');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].cluster.id).toBe('c-乱');
      expect(result[0].matched_form).toBe('乱');
    });

    it('匹配"丑"相关簇', () => {
      const result = matchAdjectiveClusters('这个按钮很丑');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].cluster.id).toBe('c-丑');
    });

    it('否定词使 magnitude 转负', () => {
      const result = matchAdjectiveClusters('不要乱', ['乱']);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].magnitude).toBeLessThan(0);
    });

    it('同一簇只匹配一次', () => {
      const result = matchAdjectiveClusters('乱乱乱');
      const luanMatches = result.filter((m) => m.cluster.id === 'c-乱');
      expect(luanMatches.length).toBe(1);
    });
  });

  describe('aggregateTagScores', () => {
    it('空匹配返回空数组', () => {
      expect(aggregateTagScores([])).toEqual([]);
    });

    it('聚合多个簇的 tag 权重', () => {
      const matches = [
        {
          cluster: {
            id: 'c-1',
            surface_forms: [],
            dimension_tags: [
              { tag: '维度: 配色', weight: 0.5 },
              { tag: '维度: 圆角', weight: 0.3 },
            ],
            magnitude_modifier: 1,
          },
          matched_form: '丑',
          magnitude: 1,
        },
        {
          cluster: {
            id: 'c-2',
            surface_forms: [],
            dimension_tags: [
              { tag: '维度: 配色', weight: 0.4 },
            ],
            magnitude_modifier: 1,
          },
          matched_form: '难看',
          magnitude: 1,
        },
      ];
      const result = aggregateTagScores(matches);
      const colorTag = result.find((s) => s.tag === '维度: 配色');
      expect(colorTag).toBeDefined();
      expect(colorTag!.weight).toBeCloseTo(0.9, 1);
      expect(colorTag!.source_clusters).toContain('c-1');
      expect(colorTag!.source_clusters).toContain('c-2');
    });

    it('被否定的簇权重为负时过滤掉', () => {
      const matches = [
        {
          cluster: {
            id: 'c-1',
            surface_forms: [],
            dimension_tags: [{ tag: '维度: 动效', weight: 0.8 }],
            magnitude_modifier: 1,
          },
          matched_form: '呆板',
          magnitude: -1, // 被否定
        },
      ];
      const result = aggregateTagScores(matches);
      expect(result.length).toBe(0);
    });

    it('结果按权重降序排列', () => {
      const matches = [
        {
          cluster: {
            id: 'c-1',
            surface_forms: [],
            dimension_tags: [
              { tag: '低权重', weight: 0.2 },
              { tag: '高权重', weight: 0.8 },
            ],
            magnitude_modifier: 1,
          },
          matched_form: 'test',
          magnitude: 1,
        },
      ];
      const result = aggregateTagScores(matches);
      expect(result[0].tag).toBe('高权重');
      expect(result[1].tag).toBe('低权重');
    });
  });

  describe('routeSeedWithClusters', () => {
    const loader = new QuestionLoader();
    loader.load();

    it('空 seed 返回首题', () => {
      const result = routeSeedWithClusters(loader, '');
      expect(result.question).toBeDefined();
      expect(result.scene).toBe('frontend-ui');
    });

    it('"圆角"路由到 s-002', () => {
      const result = routeSeedWithClusters(loader, '圆角太丑了');
      expect(result.question?.id).toBe('s-002');
    });

    it('"配色"路由到 s-005', () => {
      const result = routeSeedWithClusters(loader, '配色不好看');
      expect(result.question?.id).toBe('s-005');
    });

    it('"乱"路由到 n-001', () => {
      const result = routeSeedWithClusters(loader, '页面太乱了');
      expect(result.question?.id).toBe('n-001');
    });

    it('"丑"路由到 n-002', () => {
      const result = routeSeedWithClusters(loader, '按钮很丑');
      expect(result.question?.id).toBe('n-002');
    });

    it('返回 tagScores', () => {
      const result = routeSeedWithClusters(loader, '乱');
      expect(result.tagScores).toBeDefined();
      expect(Array.isArray(result.tagScores)).toBe(true);
    });

    it('返回 matchedClusters', () => {
      const result = routeSeedWithClusters(loader, '乱');
      expect(result.matchedClusters).toBeDefined();
      expect(Array.isArray(result.matchedClusters)).toBe(true);
    });

    it('后端场景路由', () => {
      const result = routeSeedWithClusters(loader, '新增一个 RESTful 接口');
      expect(result.scene).toBe('backend-api');
    });
  });
});
