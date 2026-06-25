// src/lib/projectScanner.ts
// 项目扫描前端层：Tauri 环境走 invoke，Web dev 环境内置自身扫描用于演示
import { isTauri } from '@/lib/env';
import { analyzeFingerprint, type ScanInput } from '@/lib/tech-rules';
import type { ProjectFingerprint } from '@/types/project';

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

// ─── Web dev 内置扫描（仅用于浏览器演示，扫描灵感大王自身）───────────────

async function scanMock(folderHint?: string): Promise<ProjectFingerprint> {
  // 硬编码本项目信息（避免静态 import package.json 的 resolveJsonModule 问题）
  const pkgJson: ScanInput['package_json'] = {
    name: '灵感大王',
    version: '0.1.0',
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      zustand: '^4.5.2',
      axios: '^1.7.7',
      uuid: '^9.0.1',
      'react-markdown': '^9.0.1',
      'react-router-dom': '^6.26.2',
      dayjs: '^1.11.13',
      echarts: '^5.5.1',
      'dnd-kit': 'file:./packages/dnd-kit',
      clsx: '^2.1.1',
      'tailwind-merge': '^2.5.2',
    },
    devDependencies: {
      typescript: '^5.5.4',
      vite: '^5.4.6',
      '@vitejs/plugin-react': '^4.3.1',
      tailwindcss: '^3.4.11',
      autoprefixer: '^10.4.20',
      postcss: '^8.4.47',
      '@types/react': '^18.3.5',
      '@types/react-dom': '^18.3.0',
      '@types/uuid': '^10.0.0',
      '@tauri-apps/api': '^2.0.0',
      '@tauri-apps/plugin-dialog': '^2.0.0',
      '@tauri-apps/plugin-fs': '^2.0.0',
      prettier: '^3.3.3',
    },
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
      tauri: 'tauri',
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
