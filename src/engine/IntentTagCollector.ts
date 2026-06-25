// src/engine/IntentTagCollector.ts
// 意图标签收集器：累计收集、chip 展示、删除后触发重生成
import type { IntentTag, IntentTagChip } from '@/types/intent-tag';
import type { PromptGenerator } from './PromptGenerator';
import type { QuestionEngine } from './QuestionEngine';
import type { PromptResult } from '@/types/prompt';

export class IntentTagCollector {
  constructor(
    private engine: QuestionEngine,
    private generator: PromptGenerator,
  ) {}

  list(): IntentTag[] {
    return this.engine.getIntentTags();
  }

  chips(): IntentTagChip[] {
    return this.list().map((t) => ({
      id: t.id,
      display_text: `${t.label}: ${t.value}`,
      color: t.source_type === 'screenshot-diagnosis' ? 'yellow' : 'purple',
      deletable: t.deletable,
    }));
  }

  remove(id: string): PromptResult | null {
    const remaining = this.engine.removeIntentTag(id);
    if (this.engine.isComplete() || this.engine.getStage() === 'COMPLETE') {
      return this.generator.regenerate(remaining, this.engine.getAnswers(), this.engine.getSeedInput());
    }
    return null;
  }

  /** 北极星埋点：当前挤出的意图标签数 */
  count(): number {
    return this.list().length;
  }
}
