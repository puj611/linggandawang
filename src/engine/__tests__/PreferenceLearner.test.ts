// src/engine/__tests__/PreferenceLearner.test.ts
import { describe, it, expect } from 'vitest';
import {
  extractPreferencesFromQA,
  extractPreferencesFromPrefs,
  buildProfile,
  recommendAnswers,
  recommendFromPreferences,
} from '../PreferenceLearner';
import type { ContextRecentQA, ContextPreference } from '@/types/context';

describe('PreferenceLearner', () => {
  describe('extractPreferencesFromQA', () => {
    it('从 QA 历史中提取偏好', () => {
      const qas: ContextRecentQA[] = [
        { question_id: 's-001', question_text: '间距', answer: 'standard', answered_at: '2026-07-15T10:00:00Z' },
        { question_id: 's-002', question_text: '圆角', answer: '8', answered_at: '2026-07-15T10:01:00Z' },
      ];
      const entries = extractPreferencesFromQA(qas);
      expect(entries.length).toBe(2);
      expect(entries[0].questionId).toBe('s-001');
      expect(entries[0].optionId).toBe('standard');
    });

    it('跳过 skipped 的答案', () => {
      const qas: ContextRecentQA[] = [
        { question_id: 's-001', question_text: '间距', answer: '__skipped__', answered_at: '' },
        { question_id: 's-002', question_text: '圆角', answer: '8', answered_at: '' },
      ];
      const entries = extractPreferencesFromQA(qas);
      expect(entries.length).toBe(1);
    });
  });

  describe('extractPreferencesFromPrefs', () => {
    it('从偏好数组中提取条目', () => {
      const prefs: ContextPreference[] = [
        { key: '风格', value: '极简', confirmed_at: '2026-07-15T10:00:00Z' },
        { key: '圆角', value: '8px', confirmed_at: '2026-07-15T10:01:00Z' },
      ];
      const entries = extractPreferencesFromPrefs(prefs);
      expect(entries.length).toBe(2);
      expect(entries[0].questionId).toBe('风格');
      expect(entries[0].optionId).toBe('极简');
    });
  });

  describe('buildProfile', () => {
    it('空数据返回空画像', () => {
      const profile = buildProfile([]);
      expect(profile.topChoices.size).toBe(0);
      expect(profile.trends.length).toBe(0);
      expect(profile.patterns.length).toBe(0);
    });

    it('频率统计：计算每题最常选', () => {
      const entries = [
        { questionId: 's-001', optionId: 'standard', timestamp: '' },
        { questionId: 's-001', optionId: 'standard', timestamp: '' },
        { questionId: 's-001', optionId: 'compact', timestamp: '' },
        { questionId: 's-002', optionId: '8', timestamp: '' },
        { questionId: 's-002', optionId: '8', timestamp: '' },
      ];
      const profile = buildProfile(entries);
      expect(profile.topChoices.get('s-001')?.optionId).toBe('standard');
      expect(profile.topChoices.get('s-001')?.count).toBe(2);
      expect(profile.topChoices.get('s-001')?.ratio).toBeCloseTo(2 / 3, 2);
      expect(profile.topChoices.get('s-002')?.optionId).toBe('8');
      expect(profile.topChoices.get('s-002')?.count).toBe(2);
    });

    it('模式挖掘：高频高一致性', () => {
      const entries = Array.from({ length: 5 }, () => ({
        questionId: 's-001',
        optionId: 'standard',
        timestamp: '',
      }));
      const profile = buildProfile(entries);
      expect(profile.patterns.length).toBe(1);
      expect(profile.patterns[0].confidence).toBe(1);
    });
  });

  describe('recommendAnswers', () => {
    it('基于画像预填答案', () => {
      const entries = Array.from({ length: 5 }, () => ({
        questionId: 's-001',
        optionId: 'standard',
        timestamp: '',
      }));
      const profile = buildProfile(entries);
      const recs = recommendAnswers(profile, ['s-001', 's-002']);
      expect(recs.get('s-001')).toBe('standard');
      expect(recs.has('s-002')).toBe(false); // s-002 不在画像中
    });

    it('低一致性不推荐', () => {
      const entries = [
        { questionId: 's-001', optionId: 'a', timestamp: '' },
        { questionId: 's-001', optionId: 'b', timestamp: '' },
      ];
      const profile = buildProfile(entries);
      const recs = recommendAnswers(profile, ['s-001']);
      expect(recs.has('s-001')).toBe(false); // 50% < 60%
    });
  });

  describe('recommendFromPreferences', () => {
    it('基于偏好数组预填', () => {
      const prefs: ContextPreference[] = [
        { key: '风格', value: '极简', confirmed_at: '' },
        { key: '风格', value: '极简', confirmed_at: '' },
        { key: '风格', value: '科技', confirmed_at: '' },
        { key: '圆角', value: '8px', confirmed_at: '' },
      ];
      const recs = recommendFromPreferences(prefs, 2);
      expect(recs.get('风格')).toBe('极简'); // 2次 >= minCount=2
      expect(recs.has('圆角')).toBe(false); // 1次 < minCount=2
    });
  });
});
