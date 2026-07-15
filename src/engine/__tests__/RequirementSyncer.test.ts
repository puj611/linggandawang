// src/engine/__tests__/RequirementSyncer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequirementSyncer } from '../RequirementSyncer';
import type { Requirement } from '@/types/requirement';

// Mock stores
vi.mock('@/stores/apiKeyStore', () => ({
  useApiKeyStore: {
    getState: () => ({
      config: null,
      hasApiKey: false,
    }),
  },
}));

vi.mock('@/stores/llmAvailabilityStore', () => ({
  useLLMAvailabilityStore: {
    getState: () => ({
      shouldAttempt: () => true,
      recordSuccess: () => {},
      recordFailure: () => {},
    }),
  },
}));

vi.mock('@/lib/llm', () => ({
  getAdapter: () => ({
    chat: vi.fn(),
  }),
}));

describe('RequirementSyncer', () => {
  let syncer: RequirementSyncer;

  beforeEach(() => {
    syncer = new RequirementSyncer();
  });

  describe('decomposeLocal (规则拆解)', () => {
    it('空描述返回基础拆解', async () => {
      const result = await syncer.decompose('');
      expect(result).not.toBeNull();
      expect(result!.requirement.subtasks.length).toBeGreaterThan(0);
      expect(result!.requirement.status).toBe('ready');
    });

    it('"修复XXX"识别为 bugfix 类型', async () => {
      const result = await syncer.decompose('修复登录按钮点击无反应');
      expect(result).not.toBeNull();
      const bugfixTask = result!.requirement.subtasks.find((s) => s.type === 'bugfix');
      expect(bugfixTask).toBeDefined();
      expect(bugfixTask!.title).toContain('修复');
    });

    it('"添加XXX"识别为 feature 类型', async () => {
      const result = await syncer.decompose('添加用户头像上传功能');
      expect(result).not.toBeNull();
      const featureTask = result!.requirement.subtasks.find((s) => s.type === 'feature');
      expect(featureTask).toBeDefined();
      expect(featureTask!.title).toContain('实现');
    });

    it('"优化XXX"识别为 refactor 类型', async () => {
      const result = await syncer.decompose('优化列表加载性能');
      expect(result).not.toBeNull();
      const refactorTask = result!.requirement.subtasks.find((s) => s.type === 'refactor');
      expect(refactorTask).toBeDefined();
      expect(refactorTask!.title).toContain('优化');
    });

    it('多条需求用分号分隔', async () => {
      const result = await syncer.decompose('修复登录按钮；添加头像功能；优化加载速度');
      expect(result).not.toBeNull();
      expect(result!.requirement.subtasks.length).toBeGreaterThanOrEqual(3);
    });

    it('生成的 requirement 有正确结构', async () => {
      const result = await syncer.decompose('修复一个bug');
      expect(result).not.toBeNull();
      const req = result!.requirement;
      expect(req.id).toMatch(/^req-/);
      expect(req.title).toBeDefined();
      expect(req.description).toBeDefined();
      expect(req.raw_input).toBe('修复一个bug');
      expect(req.subtasks.length).toBeGreaterThan(0);
      expect(req.created_at).toBeDefined();
      expect(req.updated_at).toBeDefined();
    });

    it('子任务有正确结构', async () => {
      const result = await syncer.decompose('修复一个bug');
      const st = result!.requirement.subtasks[0];
      expect(st.id).toMatch(/^st-/);
      expect(st.title).toBeDefined();
      expect(st.description).toBeDefined();
      expect(['feature', 'bugfix', 'refactor', 'test', 'docs', 'design']).toContain(st.type);
      expect(['P0', 'P1', 'P2']).toContain(st.priority);
      expect(st.estimated_hours).toBeGreaterThan(0);
      expect(st.status).toBe('pending');
      expect(st.created_at).toBeDefined();
    });
  });

  describe('updateSubtaskStatus', () => {
    function createMockRequirement(): Requirement {
      return {
        id: 'req-test',
        title: '测试需求',
        description: '测试',
        raw_input: '测试',
        subtasks: [
          {
            id: 'st-1',
            title: '任务1',
            description: '描述1',
            type: 'feature',
            status: 'pending',
            priority: 'P0',
            estimated_hours: 1,
            actual_hours: 0,
            dependencies: [],
            affected_files: [],
            related_tags: [],
            prompt_suggestion: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'st-2',
            title: '任务2',
            description: '描述2',
            type: 'feature',
            status: 'pending',
            priority: 'P1',
            estimated_hours: 2,
            actual_hours: 0,
            dependencies: ['st-1'],
            affected_files: [],
            related_tags: [],
            prompt_suggestion: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        status: 'ready',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        intent_tags: [],
      };
    }

    it('更新子任务状态为 done', () => {
      const req = createMockRequirement();
      const updated = syncer.updateSubtaskStatus(req, 'st-1', 'done');
      expect(updated.subtasks[0].status).toBe('done');
      expect(updated.subtasks[0].completed_at).toBeDefined();
    });

    it('依赖任务完成后自动解锁 blocked 任务', () => {
      const req = createMockRequirement();
      req.subtasks[1].status = 'blocked';
      const updated = syncer.updateSubtaskStatus(req, 'st-1', 'done');
      expect(updated.subtasks[1].status).toBe('pending');
    });

    it('所有任务完成时整体状态变为 completed', () => {
      const req = createMockRequirement();
      req.subtasks[0].status = 'done';
      const updated = syncer.updateSubtaskStatus(req, 'st-2', 'done');
      expect(updated.status).toBe('completed');
    });

    it('有进行中任务时整体状态变为 in_progress', () => {
      const req = createMockRequirement();
      const updated = syncer.updateSubtaskStatus(req, 'st-1', 'in_progress');
      expect(updated.status).toBe('in_progress');
    });
  });

  describe('getNextSubtask', () => {
    function createMockRequirement(): Requirement {
      return {
        id: 'req-test',
        title: '测试需求',
        description: '测试',
        raw_input: '测试',
        subtasks: [
          {
            id: 'st-1',
            title: 'P0任务',
            description: '',
            type: 'feature',
            status: 'pending',
            priority: 'P0',
            estimated_hours: 1,
            actual_hours: 0,
            dependencies: [],
            affected_files: [],
            related_tags: [],
            prompt_suggestion: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'st-2',
            title: 'P1任务',
            description: '',
            type: 'feature',
            status: 'pending',
            priority: 'P1',
            estimated_hours: 2,
            actual_hours: 0,
            dependencies: [],
            affected_files: [],
            related_tags: [],
            prompt_suggestion: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'st-3',
            title: '被阻塞任务',
            description: '',
            type: 'feature',
            status: 'pending',
            priority: 'P0',
            estimated_hours: 1,
            actual_hours: 0,
            dependencies: ['st-2'],
            affected_files: [],
            related_tags: [],
            prompt_suggestion: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        status: 'ready',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        intent_tags: [],
      };
    }

    it('返回优先级最高的待处理任务', () => {
      const req = createMockRequirement();
      const next = syncer.getNextSubtask(req);
      expect(next).not.toBeNull();
      expect(next!.id).toBe('st-1');
    });

    it('跳过被阻塞的任务', () => {
      const req = createMockRequirement();
      req.subtasks[0].status = 'done';
      const next = syncer.getNextSubtask(req);
      expect(next).not.toBeNull();
      // st-3 被 st-2 阻塞，所以应该返回 st-2
      expect(next!.id).toBe('st-2');
    });

    it('全部完成时返回 null', () => {
      const req = createMockRequirement();
      req.subtasks.forEach((st) => { st.status = 'done'; });
      const next = syncer.getNextSubtask(req);
      expect(next).toBeNull();
    });
  });

  describe('getProgress', () => {
    it('计算正确的进度', () => {
      const req: Requirement = {
        id: 'req-test',
        title: '测试',
        description: '',
        raw_input: '',
        subtasks: [
          { id: 'st-1', title: '', description: '', type: 'feature', status: 'done', priority: 'P0', estimated_hours: 1, actual_hours: 1, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '' },
          { id: 'st-2', title: '', description: '', type: 'feature', status: 'in_progress', priority: 'P1', estimated_hours: 2, actual_hours: 0.5, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '' },
          { id: 'st-3', title: '', description: '', type: 'feature', status: 'pending', priority: 'P2', estimated_hours: 1, actual_hours: 0, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '' },
        ],
        status: 'in_progress',
        created_at: '',
        updated_at: '',
        intent_tags: [],
      };
      const progress = syncer.getProgress(req);
      expect(progress.total).toBe(3);
      expect(progress.done).toBe(1);
      expect(progress.in_progress).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.percentage).toBe(33);
      expect(progress.estimated_total_hours).toBe(4);
      expect(progress.actual_total_hours).toBe(1.5);
    });

    it('跳过的任务不计入百分比', () => {
      const req: Requirement = {
        id: 'req-test',
        title: '测试',
        description: '',
        raw_input: '',
        subtasks: [
          { id: 'st-1', title: '', description: '', type: 'feature', status: 'done', priority: 'P0', estimated_hours: 1, actual_hours: 1, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '' },
          { id: 'st-2', title: '', description: '', type: 'feature', status: 'skipped', priority: 'P1', estimated_hours: 2, actual_hours: 0, dependencies: [], affected_files: [], related_tags: [], prompt_suggestion: '', created_at: '', updated_at: '' },
        ],
        status: 'completed',
        created_at: '',
        updated_at: '',
        intent_tags: [],
      };
      const progress = syncer.getProgress(req);
      expect(progress.percentage).toBe(100); // 1/1 = 100%
    });
  });
});
