// src/lib/projectScanner.ts
// 项目扫描前端层：Tauri 环境走 invoke，Web dev 环境内置自身扫描用于演示
import { isTauri } from '@/lib/env';
import { analyzeFingerprint, type ScanInput } from '@/lib/tech-rules';
import type { ProjectFingerprint, FullScanResult } from '@/types/project';

// Tauri 侧待实现的命令名
const CMD_PICK_FOLDER = 'pick_project_folder';
const CMD_SCAN_PROJECT = 'scan_project';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null | undefined;

async function getInvoke(): Promise<InvokeFn | null> {
  if (cachedInvoke !== undefined) return cachedInvoke;
  if (!isTauri()) {
    cachedInvoke = null;
    return null;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    cachedInvoke = invoke as InvokeFn;
    return cachedInvoke;
  } catch {
    cachedInvoke = null;
    return null;
  }
}

/**
 * 弹出系统文件夹选择框，返回选中的绝对路径。
 * Tauri 可用；Web 环境返回 null。
 */
export async function pickProjectFolder(): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    const path = await invoke<string | null>(CMD_PICK_FOLDER);
    return path ?? null;
  } catch {
    return null;
  }
}

/**
 * 扫描指定路径的项目，返回指纹。
 * Tauri 环境通过 Rust 命令读取磁盘；Web dev 环境回退到内置 mock。
 */
export async function scanProject(path: string): Promise<ProjectFingerprint> {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      const input = await invoke<ScanInput>(CMD_SCAN_PROJECT, { path });
      if (input && input.root_path) {
        return analyzeFingerprint(input);
      }
    } catch (e) {
      console.warn('[projectScanner] Rust 命令不可用，回退 mock：', e);
    }
  }
  return scanMock(path);
}

// ─── M10: 项目深度扫描 ────────────────────────────────────────

const CMD_FULL_SCAN = 'full_scan_project';

/**
 * 深度扫描项目：文件结构 + Git 状态 + 依赖图 + TODO/FIXME
 * Tauri 环境通过 Rust 命令执行；Web 环境返回 null。
 */
export async function fullScanProject(path: string, maxDepth?: number): Promise<FullScanResult | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    const args: Record<string, unknown> = { path };
    if (maxDepth !== undefined) args.maxDepth = maxDepth;
    return await invoke<FullScanResult>(CMD_FULL_SCAN, args);
  } catch (e) {
    console.warn('[projectScanner] full_scan_project 失败：', e);
    return null;
  }
}

// ─── Web dev 内置扫描（仅用于浏览器演示，扫描灵感大王自身）───────────────

async function scanMock(folderHint?: string): Promise<ProjectFingerprint> {
  // 硬编码本项目信息（避免静态 import package.json 的 resolveJsonModule 问题）
  // P2 修复：与 package.json 实际依赖对齐，移除已删除的 echarts/dnd-kit/axios/react-markdown 等
  const pkgJson: ScanInput['package_json'] = {
    name: 'linggandawang',
    version: '0.1.0',
    dependencies: {
      '@tauri-apps/api': '^2.11.1',
      '@tauri-apps/plugin-dialog': '^2.7.1',
      '@tauri-apps/plugin-global-shortcut': '^2.3.2',
      '@tauri-apps/plugin-sql': '^2.4.0',
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      uuid: '^11.0.0',
      yaml: '^2.4.5',
      zustand: '^4.5.4',
    },
    devDependencies: {
      '@tauri-apps/cli': '^2.11.3',
      '@types/node': '^25.9.3',
      '@types/react': '^18.3.3',
      '@types/react-dom': '^18.3.0',
      '@types/uuid': '^9.0.8',
      '@typescript-eslint/eslint-plugin': '^8.64.0',
      '@typescript-eslint/parser': '^8.64.0',
      '@vitejs/plugin-react': '^4.3.0',
      'autoprefixer': '^10.4.19',
      'eslint': '^10.7.0',
      'eslint-plugin-react-hooks': '^7.1.1',
      'eslint-plugin-react-refresh': '^0.5.3',
      'jsdom': '^24.1.0',
      'postcss': '^8.4.38',
      'tailwindcss': '^3.4.4',
      'typescript': '^5.4.5',
      'vite': '^5.2.12',
      'vitest': '^1.6.0',
    },
    scripts: {
      dev: 'vite',
      build: 'tsc -b && vite build',
      preview: 'vite preview --port 4173',
      lint: 'eslint src/',
      format: 'prettier --write "src/**/*.{ts,tsx,css}"',
      test: 'vitest run',
      'test:watch': 'vitest',
    },
  };

  // src 目录硬编码（基于当前项目结构）
  const srcDirs = [
    'components',
    'engine',
    'hooks',
    'lib',
    'stores',
    'styles',
    'test',
    'types',
  ];

  // 根目录文件（基于项目实际）
  const rootFiles = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'tailwind.config.ts',
    'postcss.config.js',
    'index.html',
    '.gitignore',
    '.prettierrc',
    '.editorconfig',
    'README.md',
    'components.json',
  ];

  const rootDirs = [
    'src',
    'public',
    'src-tauri',
    'dist',
    'scripts',
    'docs',
    'deliverables',
    '.playwright-cli',
  ];

  const rootPath = folderHint && folderHint.trim() ? folderHint : 'd:\\AI工作平台\\灵感大王';

  return analyzeFingerprint({
    root_path: rootPath,
    root_files: rootFiles,
    src_dirs: srcDirs,
    root_dirs: rootDirs,
    package_json: pkgJson,
  });
}
