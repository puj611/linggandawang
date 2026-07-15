// src/engine/__tests__/seedRouter.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  detectNegation,
  detectScene,
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
