// src/engine/QuestionLoader.ts
// 问题库加载器：从 bank.yaml 加载 + schema 校验 + 用户目录覆盖（T8.4：文件系统读取）
import { parse as parseYaml } from 'yaml';
import { isTauri } from '@/lib/env';
import type { QuestionBank, Question, PromptStage } from './types';
import { STAGE_ORDER } from './types';
import bankYamlText from '@/question-bank/bank.yaml?raw';

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
  private bank: QuestionBank | null = null;
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

  /** 加载内置 + 用户覆盖后的问题库 */
  load(): QuestionBank {
    if (this.bank) return this.bank;

    const builtin = this.parseAndValidate(bankYamlText, 'builtin');
    let merged = builtin;

    // T8.4：从文件系统读取用户覆盖（预加载到内存）
    if (this.userBankText) {
      const userBank = this.parseAndValidate(this.userBankText, 'user');
      merged = this.mergeBank(builtin, userBank);
    }

    this.bank = merged;
    return merged;
  }

  /** 手动刷新问题库 */
  async reload(): Promise<QuestionBank> {
    this.bank = null;
    this.preloaded = false;
    await this.preloadUserBank();
    return this.load();
  }

  /** 设置用户覆盖（设置面板调用） */
  async setUserBank(yaml: string): Promise<void> {
    this.userBankText = yaml;
    this.bank = null; // 清除缓存，下次 load 重新合并
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
    this.bank = null; // 清除缓存，下次 load 重新合并
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('clear_user_bank');
    } catch (e) {
      console.error('[QuestionLoader] 清除用户 bank 失败', e);
      throw e;
    }
  }

  getBank(): QuestionBank {
    if (!this.bank) this.load();
    return this.bank!;
  }

  getQuestionById(id: string): Question | undefined {
    return this.getBank().questions.find((q) => q.id === id);
  }

  getQuestionsByStage(stage: QuestionBank['stages'][number]['id']): Question[] {
    return this.getBank()
      .questions.filter((q) => q.stage === stage)
      .sort((a, b) => a.order - b.order);
  }

  private parseAndValidate(text: string, source: 'builtin' | 'user'): QuestionBank {
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
