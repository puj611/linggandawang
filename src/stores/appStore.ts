// src/stores/appStore.ts
// 应用 FSM：四态切换，与架构设计 8.3 节一致
import { create } from 'zustand';
import type { AppState } from '@/types/state';
import type { SceneChoice } from '@/engine/types';
import type { TargetTool } from '@/engine/targetToolProfiles';
import type { PromptResult } from '@/types/prompt';

// 三模式系统：localStorage 持久化用户选择的场景
const SCENE_STORAGE_KEY = 'linggan_scene_choice';
function loadStoredSceneChoice(): SceneChoice {
  try {
    const v = localStorage.getItem(SCENE_STORAGE_KEY);
    if (v === 'ppt' || v === 'frontend-ui' || v === 'backend-api' || v === 'auto') return v;
  } catch {
    // 静默降级
  }
  return 'auto';
}

// Task 8：localStorage 持久化用户选择的目标工具
const TARGET_TOOL_STORAGE_KEY = 'linggan_target_tool';
function loadStoredTargetTool(): TargetTool {
  try {
    const v = localStorage.getItem(TARGET_TOOL_STORAGE_KEY);
    if (v === 'generic' || v === 'claude-code' || v === 'cursor' || v === 'copilot' || v === 'codex') {
      return v;
    }
  } catch {
    // 静默降级
  }
  return 'generic';
}

type LLMModeOverride = 'cloud' | 'local' | 'basic' | null;

interface AppStore {
  state: AppState;
  settingsOpen: boolean;
  /** R04：前后对比面板开合（ComparePanel 挂载开关） */
  compareOpen: boolean;
  /** R04：对比 A/B 槽位（存于全局 store，面板卸载后不丢态，保障「载入 A→关面板→再生成→开面板→载入 B」链路） */
  compareLeft: PromptResult | null;
  compareRight: PromptResult | null;
  skipConfirmOpen: boolean;
  /** 三模式系统：全局共享的场景选择（ExpandedCard 写入，ReferenceImagePanel 等读取） */
  sceneChoice: SceneChoice;
  /** Task 8：目标工具选择（ExpandedCard 写入，useFlow 生成时 getState 读取），决定提示词结构适配 */
  targetTool: TargetTool;
  /** LLM 模式手动覆盖（null=自动检测，'basic'=强制基础模式跳过 LLM，'cloud'=强制云端，'local'=强制本地） */
  llmModeOverride: LLMModeOverride;
  transition: (next: AppState) => void;
  toggleExpand: () => void;
  expand: () => void;
  collapse: () => void;
  backToExpanded: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  /** R04：打开/关闭前后对比面板 */
  openCompare: () => void;
  closeCompare: () => void;
  /** R04：写入对比槽位（result 为 null 表示清空该槽） */
  setCompareSlot: (slot: 'left' | 'right', result: PromptResult | null) => void;
  /** R04：交换 A/B 槽位 */
  swapCompareSlots: () => void;
  openSkipConfirm: () => void;
  closeSkipConfirm: () => void;
  /** 三模式系统：设置场景选择并持久化到 localStorage */
  setSceneChoice: (s: SceneChoice) => void;
  /** Task 8：设置目标工具并持久化到 localStorage */
  setTargetTool: (tool: TargetTool) => void;
  /** 设置 LLM 模式手动覆盖 */
  setLlmModeOverride: (m: LLMModeOverride) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  state: 'ball',
  settingsOpen: false,
  compareOpen: false,
  compareLeft: null,
  compareRight: null,
  skipConfirmOpen: false,
  sceneChoice: loadStoredSceneChoice(),
  targetTool: loadStoredTargetTool(),
  llmModeOverride: null,
  transition: (next) => set({ state: next }),
  toggleExpand: () => {
    const cur = get().state;
    if (cur === 'ball') set({ state: 'expanded' });
    else set({ state: 'ball' });
  },
  expand: () => set({ state: 'expanded' }),
  collapse: () => set({ state: 'ball', settingsOpen: false, compareOpen: false, skipConfirmOpen: false }),
  backToExpanded: () => set({ state: 'expanded', settingsOpen: false, compareOpen: false, skipConfirmOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openCompare: () => set({ compareOpen: true }),
  closeCompare: () => set({ compareOpen: false }),
  // 注意：关闭面板（closeCompare）/收起（collapse）/返回（backToExpanded）均不清空槽位——
  // 槽位是跨面板生命周期保留的对比数据，仅用户点槽位 × 时清空
  setCompareSlot: (slot, result) =>
    set(slot === 'left' ? { compareLeft: result } : { compareRight: result }),
  swapCompareSlots: () => set((st) => ({ compareLeft: st.compareRight, compareRight: st.compareLeft })),
  openSkipConfirm: () => set({ skipConfirmOpen: true }),
  closeSkipConfirm: () => set({ skipConfirmOpen: false }),
  setSceneChoice: (s) => {
    set({ sceneChoice: s });
    try {
      localStorage.setItem(SCENE_STORAGE_KEY, s);
    } catch {
      // 静默降级
    }
  },
  setTargetTool: (tool) => {
    set({ targetTool: tool });
    try {
      localStorage.setItem(TARGET_TOOL_STORAGE_KEY, tool);
    } catch {
      // 静默降级
    }
  },
  setLlmModeOverride: (m) => set({ llmModeOverride: m }),
}));
