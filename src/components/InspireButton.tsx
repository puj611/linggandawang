// src/components/InspireButton.tsx
// 灵感广场按钮：点击弹出当前场景的种子列表，一键填充输入框
import { useState, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { getSeedsByScene } from '@/data/inspireSeeds';
import type { SceneType } from '@/engine/types';

interface Props {
  /** 选中种子后回调，将种子文本填充到输入框 */
  onSelect: (seed: string) => void;
}

// 场景中文标签
const SCENE_LABELS: Record<SceneType, string> = {
  'frontend-ui': '前端 UI',
  'backend-api': '后端 API',
  'ppt': 'PPT',
};

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function InspireButton({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  // 换一个计数器：每次自增触发 useMemo 重新随机抽取，避免调用 onSelect 直接填入输入框
  const [shuffleVersion, setShuffleVersion] = useState(0);
  const sceneChoice = useAppStore((s) => s.sceneChoice);

  // auto 模式：每类随机取 2 个，共 6 个；显式场景：打乱该场景全部种子顺序
  // 依赖 shuffleVersion：点"换一个"时仅刷新列表显示，不触发 onSelect、不关闭面板
  const seeds = useMemo(() => {
    if (sceneChoice === 'auto') {
      return [
        ...shuffle(getSeedsByScene('ppt')).slice(0, 2),
        ...shuffle(getSeedsByScene('frontend-ui')).slice(0, 2),
        ...shuffle(getSeedsByScene('backend-api')).slice(0, 2),
      ];
    }
    return shuffle(getSeedsByScene(sceneChoice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneChoice, shuffleVersion]);

  const handleSelect = (seed: string) => {
    onSelect(seed);
    setOpen(false);
  };

  // 换一个：仅刷新列表显示，不填充输入框、不关闭面板
  const handleShuffle = () => {
    setShuffleVersion((v) => v + 1);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="没有灵感？点击查看种子模板"
        className="text-xs text-brand hover:text-brand-strong transition-colors flex items-center gap-1"
      >
        <span>✨</span>
        <span>灵感</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 window-panel p-3 max-h-72 overflow-y-auto animate-pop-in">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-text-secondary font-medium">
              {sceneChoice === 'auto' ? '全部场景种子' : `${SCENE_LABELS[sceneChoice]}种子`}
            </span>
            <button
              type="button"
              onClick={handleShuffle}
              className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
            >
              🎲 换一个
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {seeds.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelect(s.seed)}
                title={s.description}
                className="text-left px-2 py-1.5 text-xs rounded-btn bg-surface-2 hover:bg-surface-1 hover:text-text-primary text-text-secondary transition-colors border border-transparent hover:border-brand/30"
              >
                <div className="font-medium truncate">{s.title}</div>
                <div className="text-text-tertiary truncate mt-0.5">{s.seed}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
