// src/engine/QuestionLoader.ts
// 问题库加载器：从 bank.yaml + bank-backend.yaml 加载多场景 + schema 校验 + 用户目录覆盖（T8.4：文件系统读取）
// P1.1：扩展支持 backend-api 场景，保持原有 API 向后兼容
import { parse as parseYaml } from 'yaml';
import { isTauri } from '@/lib/env';
import type { QuestionBank, Question, PromptStage } from './types';
import { STAGE_ORDER } from './types';
import bankYamlText from '@/question-bank/bank.yaml?raw';
import bankBackendYamlText from '@/question-bank/bank-backend.yaml?raw';

/** 内置支持的场景列表（scene → bank 文本） */
const BUILTIN_BANKS: { scene: string; text: string; source: string }[] = [
  { scene: 'frontend-ui', text: bankYamlText, source: 'builtin-frontend' },
  { scene: 'backend-api', text: bankBackendYamlText, source: 'builtin-backend' },
];

async function getInvoke() {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke;
  } catch {
    return null;
  }
}

export class QuestionLoader {
  /** 多场景问题库缓存（scene → QuestionBank） */
  private banks: Map<string, QuestionBank> = new Map();
  /** 当前激活场景（默认 frontend-ui，保持向后兼容） */
  private activeScene: string = 'frontend-ui';
  private userBankText: string | null = null;
  private preloaded = false;

  /** 预加载用户覆盖的 bank.yaml（App 启动时调用） */
  async preloadUserBank(): Promise<void> {
    if (this.preloaded) return;
    this.preloaded = true;
    const invoke = await getInvoke();
    if (!invoke) {
      this.userBankText = null;
      return;
    }
    try {
      const text = await invoke<string>('load_user_bank');
      this.userBankText = text || null;
    } catch (e) {
      console.warn('[QuestionLoader] 加载用户 bank 失败', e);
      this.userBankText = null;
    }
  }

  /** 加载所有内置场景库 + 用户覆盖（仅对 frontend-ui 生效），返回当前激活场景的问题库 */
  load(): QuestionBank {
    const cached = this.banks.get(this.activeScene);
    if (cached) return cached;
    this.loadAllBanks();
    return this.banks.get(this.activeScene)!;
  }

  /** 加载所有内置场景问题库到内存 */
  private loadAllBanks(): void {
    for (const entry of BUILTIN_BANKS) {
      if (this.banks.has(entry.scene)) continue;
      const builtin = this.parseAndValidate(entry.text, entry.source);
      // 用户覆盖仅对 frontend-ui 场景生效（保持向后兼容）
      if (entry.scene === 'frontend-ui' && this.userBankText) {
        const userBank = this.parseAndValidate(this.userBankText, 'user');
        this.banks.set(entry.scene, this.mergeBank(builtin, userBank));
      } else {
        this.banks.set(entry.scene, builtin);
      }
    }
  }

  /** 手动刷新问题库 */
  async reload(): Promise<QuestionBank> {
    this.banks.clear();
    this.preloaded = false;
    await this.preloadUserBank();
    return this.load();
  }

  /** 设置用户覆盖（设置面板调用） */
  async setUserBank(yaml: string): Promise<void> {
    this.userBankText = yaml;
    this.banks.clear(); // 清除缓存，下次 load 重新合并
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('save_user_bank', { payload: { content: yaml } });
    } catch (e) {
      console.error('[QuestionLoader] 保存用户 bank 失败', e);
      throw e;
    }
  }

  /** 清除用户覆盖 */
  async clearUserBank(): Promise<void> {
    this.userBankText = null;
    this.banks.clear(); // 清除缓存，下次 load 重新合并
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('clear_user_bank');
    } catch (e) {
      console.error('[QuestionLoader] 清除用户 bank 失败', e);
      throw e;
    }
  }

  /** 获取当前激活场景的问题库 */
  getBank(): QuestionBank {
    return this.load();
  }

  /** 返回当前激活场景（P1.1 新增） */
  getScene(): string {
    return this.activeScene;
  }

  /** 设置当前激活场景（P1.1 新增） */
  setScene(scene: string): void {
    if (this.activeScene === scene) return;
    this.activeScene = scene;
  }

  /** 按 ID 查找问题：先查当前场景，找不到则跨场景查找（支持 seedRouter 跨场景路由） */
  getQuestionById(id: string): Question | undefined {
    // 确保所有库已加载
    if (this.banks.size === 0) this.load();
    // 先在当前激活场景中查找
    const active = this.banks.get(this.activeScene);
    if (active) {
      const q = active.questions.find((q) => q.id === id);
      if (q) return q;
    }
    // 跨场景查找（seedRouter 可能返回另一场景的题目 ID）
    for (const bank of this.banks.values()) {
      const q = bank.questions.find((q) => q.id === id);
      if (q) return q;
    }
    return undefined;
  }

  getQuestionsByStage(stage: QuestionBank['stages'][number]['id']): Question[] {
    return this.getBank()
      .questions.filter((q) => q.stage === stage)
      .sort((a, b) => a.order - b.order);
  }

  private parseAndValidate(text: string, source: string): QuestionBank {
    let obj: unknown;
    try {
      obj = parseYaml(text);
    } catch (e) {
      throw new Error(`[QuestionLoader] ${source} YAML 解析失败: ${(e as Error).message}`);
    }
    if (!obj || typeof obj !== 'object') {
      throw new Error(`[QuestionLoader] ${source} YAML 顶层不是对象`);
    }
    const bank = obj as Partial<QuestionBank>;
    if (bank.schema_version !== '1.0') {
      throw new Error(`[QuestionLoader] ${source} schema_version 不匹配，期望 1.0 实际 ${bank.schema_version}`);
    }
    if (!Array.isArray(bank.questions) || bank.questions.length === 0) {
      throw new Error(`[QuestionLoader] ${source} questions 为空或非数组`);
    }
    if (!Array.isArray(bank.stages) || bank.stages.length !== 5) {
      throw new Error(`[QuestionLoader] ${source} stages 必须为 5 个`);
    }
    // ID 唯一性校验
    const ids = new Set<string>();
    for (const q of bank.questions) {
      if (ids.has(q.id)) throw new Error(`[QuestionLoader] ${source} 问题 ID 重复: ${q.id}`);
      ids.add(q.id);
    }
    return bank as QuestionBank;
  }

  /** 按 bank_id 合并 questions，user 覆盖 builtin（同 ID） */
  private mergeBank(builtin: QuestionBank, user: QuestionBank): QuestionBank {
    if (user.bank_id !== builtin.bank_id) {
      // 不同 bank_id 不合并，直接返回 user
      return user;
    }
    const map = new Map<string, Question>();
    for (const q of builtin.questions) map.set(q.id, q);
    for (const q of user.questions) map.set(q.id, q);
    return {
      ...builtin,
      total_questions: map.size,
      questions: Array.from(map.values()).sort((a, b) => {
        const aIdx = STAGE_ORDER.indexOf(a.stage as PromptStage);
        const bIdx = STAGE_ORDER.indexOf(b.stage as PromptStage);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.order - b.order;
      }),
    };
  }
}

export const questionLoader = new QuestionLoader();
