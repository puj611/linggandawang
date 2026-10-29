// src/engine/__tests__/layering.test.ts
// 分层架构回归（2026-10-29 大审查 H2）：
// AGENTS.md 规定引擎层「纯业务逻辑，不依赖 Tauri API / React」，但审查发现 4 处
// engine 反向 import '@/stores'（ImagePromptExtractor / LLMIntentAnalyzer /
// RequirementSyncer / SmartFollowup），导致 MCP 复用引擎时会被拽入 zustand + Tauri invoke。
//
// 本测试用「源码扫描」而非运行时断言：分层是静态结构约束，扫描最直接且无副作用。
// 唯一已知例外：QuestionLoader.ts 通过 isTauri() 门控的动态 import 访问 Tauri
// （AGENTS 坑点已备案），下面显式放行该模式。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// 注意：jsdom 环境下 import.meta.url 不是 file:// 协议，fileURLToPath 会抛
// "The URL must be of scheme file"。vitest 的 cwd 恒为项目根，直接用它更稳。
const PROJECT_ROOT = process.cwd();
const ENGINE_DIR = join(PROJECT_ROOT, 'src', 'engine');

/** 递归收集 engine 下的生产源码（排除 __tests__） */
function collectEngineFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      collectEngineFiles(full, acc);
    } else if (entry.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  kind: string;
}

function scanImports(): Violation[] {
  const out: Violation[] = [];
  for (const file of collectEngineFiles(ENGINE_DIR)) {
    const rel = relative(PROJECT_ROOT, file).replace(/\\/g, '/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line.startsWith('import') && !line.includes('await import(')) return;
      // 禁止：engine 直接依赖 zustand stores（审查 H2）
      if (/from ['"]@\/stores/.test(line) || /import\(['"]@\/stores/.test(line)) {
        out.push({ file: rel, line: idx + 1, text: line, kind: "engine -> @/stores" });
      }
      // 禁止：engine 顶层静态依赖 Tauri API
      // 例外：QuestionLoader 用 isTauri() 门控的动态 import（AGENTS 坑点备案）
      if (/from ['"]@tauri-apps\//.test(line)) {
        out.push({ file: rel, line: idx + 1, text: line, kind: "engine -> @tauri-apps (静态 import)" });
      }
      // 禁止：engine 依赖 React
      if (/from ['"]react['"]/.test(line)) {
        out.push({ file: rel, line: idx + 1, text: line, kind: "engine -> react" });
      }
    });
  }
  return out;
}

/**
 * 已知例外（2026-10-29 审查后确认，待 B 类解耦后逐个移除）：
 *   - useApiKeyStore       取 config / hasApiKey 判定（明文 key 已移除，见 H1 修复）
 *   - useLLMAvailabilityStore  熔断器 shouldAttempt/recordSuccess/recordFailure
 *   - useAppStore          基础/增强模式 llmModeOverride
 * 这三项都是「跨切面运行时状态」，正确解法是由 hooks 层注入，属独立重构（backlog）。
 * 本测试的价值是「锁住不再新增」，而不是「一次清零」。
 */
const KNOWN_ENGINE_STORE_DEPS = new Set([
  '@/stores/apiKeyStore',
  '@/stores/llmAvailabilityStore',
  '@/stores/appStore',
]);

/** 从 import 行里抽出 module specifier */
function specifierOf(line: string): string | null {
  const m = line.match(/(?:from|import\()\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

describe('分层约束：引擎层纯度', () => {
  it('engine 不得新增 @/stores 依赖（已有 3 个例外已知，见上方注释）', () => {
    const violations = scanImports()
      .filter((v) => v.kind === "engine -> @/stores")
      .filter((v) => {
        const spec = specifierOf(v.text);
        return spec === null || !KNOWN_ENGINE_STORE_DEPS.has(spec);
      });
    if (violations.length > 0) {
      const detail = violations.map((v) => `${v.file}:${v.line}  ${v.text}`).join('\n');
      throw new Error(
        `引擎层新增了未登记的 stores 依赖（会连带拉起 zustand，破坏 MCP 复用）：\n${detail}\n` +
          `如确属必要，请先把该项加入 KNOWN_ENGINE_STORE_DEPS 并说明理由。`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('engine 不得取明文 API Key（H1 回归保护）', () => {
    const offenders: Violation[] = [];
    for (const file of collectEngineFiles(ENGINE_DIR)) {
      const rel = relative(PROJECT_ROOT, file).replace(/\\/g, '/');
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((raw, idx) => {
          if (/\.getApiKey\s*\(/.test(raw)) {
            offenders.push({ file: rel, line: idx + 1, text: raw.trim(), kind: 'engine 取明文 key' });
          }
        });
    }
    if (offenders.length > 0) {
      const detail = offenders.map((v) => `${v.file}:${v.line}  ${v.text}`).join('\n');
      throw new Error(
        `引擎层不得调用 getApiKey() —— Tauri 下 key 由 Rust 代理注入，取明文是无谓泄露：\n${detail}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('engine 不得顶层静态 import @tauri-apps（仅允许 isTauri 门控的动态 import）', () => {
    const violations = scanImports().filter((v) => v.kind.startsWith("engine -> @tauri-apps"));
    expect(violations).toEqual([]);
  });

  it('engine 不得 import react', () => {
    const violations = scanImports().filter((v) => v.kind === "engine -> react");
    expect(violations).toEqual([]);
  });

  it('扫描确实覆盖到了 engine 源码（防止测试空转）', () => {
    const files = collectEngineFiles(ENGINE_DIR);
    expect(files.length).toBeGreaterThan(10);
  });
});
