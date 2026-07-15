// src/engine/__tests__/TemplateRetriever.test.ts
import { describe, it, expect } from 'vitest';
import { TemplateRetriever } from '../TemplateRetriever';
import type { IntentTag } from '@/types/intent-tag';

describe('TemplateRetriever', () => {
  const retriever = new TemplateRetriever();

  describe('retrieve', () => {
    it('空 seed 返回 null', () => {
      expect(retriever.retrieve('')).toBeNull();
    });

    it('"圆角太丑了"匹配 fix-radius 模板', () => {
      const result = retriever.retrieve('圆角太丑了');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('fix-radius');
    });

    it('"配色不好看"匹配 fix-color 模板', () => {
      const result = retriever.retrieve('配色不好看');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('fix-color');
    });

    it('"间距太挤了"匹配 fix-spacing 模板', () => {
      const result = retriever.retrieve('间距太挤了');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('fix-spacing');
    });

    it('"极简风格"匹配 style-minimal 模板', () => {
      const result = retriever.retrieve('极简风格');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('style-minimal');
    });

    it('"加个 hover 效果"匹配 add-hover 模板', () => {
      const result = retriever.retrieve('加个 hover 效果');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('add-hover');
    });

    it('意图标签增强匹配', () => {
      const tags: IntentTag[] = [
        { id: '1', label: '痛点', value: '间距太挤', stage: 'perceive', source_question_id: '', source_type: 'option', confidence: 0.8, deletable: true, created_at: '' },
      ];
      const result = retriever.retrieve('页面调整', tags);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('fix-spacing');
    });
  });

  describe('retrieveTopK', () => {
    it('返回 Top-K 匹配模板', () => {
      const results = retriever.retrieveTopK('圆角和配色都不好', [], [], 3);
      expect(results.length).toBeLessThanOrEqual(3);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
    });

    it('空 seed 返回空数组', () => {
      expect(retriever.retrieveTopK('')).toEqual([]);
    });
  });

  describe('getById', () => {
    it('根据 ID 获取模板', () => {
      const template = retriever.getById('fix-radius');
      expect(template).toBeDefined();
      expect(template!.name).toBe('统一圆角风格');
    });

    it('不存在的 ID 返回 undefined', () => {
      expect(retriever.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('返回所有模板', () => {
      const all = retriever.getAll();
      expect(all.length).toBeGreaterThanOrEqual(10);
    });
  });
});
