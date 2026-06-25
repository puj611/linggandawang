// src/lib/tech-rules.ts
// 技术栈识别规则：通过 package.json 依赖和文件存在性推导 ProjectFingerprint
import type {
  ProjectFingerprint,
  Framework,
  CssSolution,
  BuildTool,
  PackageManager,
  ProjectType,
  ProjectStructure,
} from '@/types/project';

// ─── 规则表 ───────────────────────────────────────────────

interface FileRule {
  file: string;
  tag: string;
}

// 框架识别：dependencies 命中某包即判定
const FRAMEWORK_RULES: { pkg: string; tag: Framework }[] = [
  { pkg: 'next', tag: 'next' },
  { pkg: 'nuxt', tag: 'nuxt' },
  { pkg: 'react', tag: 'react' },
  { pkg: 'vue', tag: 'vue' },
  { pkg: 'svelte', tag: 'svelte' },
  { pkg: '@angular/core', tag: 'angular' },
  { pkg: 'solid-js', tag: 'solid' },
  { pkg: 'preact', tag: 'preact' },
  { pkg: '@builder.io/qwik', tag: 'qwik' },
  { pkg: 'astro', tag: 'astro' },
  { pkg: '@remix-run/react', tag: 'remix' },
];

// UI 组件库识别
const UI_LIB_RULES: { pkg: string; label: string }[] = [
  { pkg: 'antd', label: 'Ant Design' },
  { pkg: '@arco-design/web-react', label: 'Arco Design' },
  { pkg: '@mui/material', label: 'MUI' },
  { pkg: '@chakra-ui/react', label: 'Chakra UI' },
  { pkg: 'element-plus', label: 'Element Plus' },
  { pkg: 'naive-ui', label: 'Naive UI' },
  { pkg: 'primereact', label: 'PrimeReact' },
  { pkg: '@mantine/core', label: 'Mantine' },
  { pkg: 'radix-ui', label: 'Radix UI' },
  { pkg: 'react-bootstrap', label: 'React Bootstrap' },
  { pkg: 'grommet', label: 'Grommet' },
];

// CSS 方案识别（优先文件存在性判断）
const CSS_FILE_RULES: FileRule[] = [
  { file: 'tailwind.config.js', tag: 'tailwind' },
  { file: 'tailwind.config.ts', tag: 'tailwind' },
  { file: 'tailwind.config.cjs', tag: 'tailwind' },
  { file: 'tailwind.config.mjs', tag: 'tailwind' },
  { file: 'uno.config.ts', tag: 'unocss' },
  { file: 'uno.config.js', tag: 'unocss' },
  { file: 'vanilla-extract.config.ts', tag: 'vanilla-extract' },
];

const CSS_PKG_RULES: { pkg: string; tag: CssSolution }[] = [
  { pkg: 'styled-components', tag: 'styled-components' },
  { pkg: '@emotion/react', tag: 'emotion' },
  { pkg: 'sass', tag: 'sass' },
  { pkg: 'less', tag: 'less' },
];

// 状态管理
const STATE_RULES: { pkg: string; label: string }[] = [
  { pkg: 'zustand', label: 'Zustand' },
  { pkg: 'redux', label: 'Redux' },
  { pkg: '@reduxjs/toolkit', label: 'Redux Toolkit' },
  { pkg: 'mobx', label: 'MobX' },
  { pkg: 'pinia', label: 'Pinia' },
  { pkg: 'jotai', label: 'Jotai' },
  { pkg: 'recoil', label: 'Recoil' },
  { pkg: 'valtio', label: 'Valtio' },
  { pkg: 'xstate', label: 'XState' },
  { pkg: '@tanstack/store', label: 'TanStack Store' },
];

// 构建工具（配置文件存在性优先）
const BUILD_FILE_RULES: FileRule[] = [
  { file: 'vite.config.ts', tag: 'vite' },
  { file: 'vite.config.js', tag: 'vite' },
  { file: 'vite.config.mjs', tag: 'vite' },
  { file: 'next.config.js', tag: 'turbopack' },
  { file: 'next.config.mjs', tag: 'turbopack' },
  { file: 'next.config.ts', tag: 'turbopack' },
  { file: 'rsbuild.config.ts', tag: 'rsbuild' },
  { file: 'rspack.config.js', tag: 'rsbuild' },
  { file: 'webpack.config.js', tag: 'webpack' },
  { file: 'webpack.config.ts', tag: 'webpack' },
  { file: 'parcel.config.js', tag: 'parcel' },
  { file: 'rollup.config.js', tag: 'rollup' },
  { file: 'rollup.config.mjs', tag: 'rollup' },
];

// 其他特性：依赖存在即标记
const FEATURE_PKG_RULES: { pkg: string; label: string }[] = [
  { pkg: 'typescript', label: 'TypeScript' },
  { pkg: 'eslint', label: 'ESLint' },
  { pkg: 'prettier', label: 'Prettier' },
  { pkg: 'vitest', label: 'Vitest' },
  { pkg: 'jest', label: 'Jest' },
  { pkg: '@testing-library/react', label: 'Testing Library' },
  { pkg: 'playwright', label: 'Playwright' },
  { pkg: 'cypress', label: 'Cypress' },
  { pkg: 'storybook', label: 'Storybook' },
  { pkg: 'react-router-dom', label: 'React Router' },
  { pkg: '@tanstack/react-query', label: 'React Query' },
  { pkg: '@tanstack/react-table', label: 'React Table' },
  { pkg: 'react-hook-form', label: 'React Hook Form' },
  { pkg: 'zod', label: 'Zod' },
  { pkg: 'axios', label: 'Axios' },
  { pkg: 'ky', label: 'Ky' },
  { pkg: 'framer-motion', label: 'Framer Motion' },
  { pkg: 'gsap', label: 'GSAP' },
  { pkg: 'i18next', label: 'i18n' },
  { pkg: 'react-i18next', label: 'i18n' },
  { pkg: 'docker', label: 'Docker' },
];

const FEATURE_FILE_RULES: FileRule[] = [
  { file: '.eslintrc.js', tag: 'ESLint' },
  { file: '.eslintrc.cjs', tag: 'ESLint' },
  { file: '.eslintrc.json', tag: 'ESLint' },
  { file: 'eslint.config.js', tag: 'ESLint' },
  { file: 'eslint.config.mjs', tag: 'ESLint' },
  { file: '.prettierrc', tag: 'Prettier' },
  { file: '.prettierrc.js', tag: 'Prettier' },
  { file: '.prettierrc.json', tag: 'Prettier' },
  { file: 'prettier.config.js', tag: 'Prettier' },
  { file: 'docker-compose.yml', tag: 'Docker' },
  { file: 'Dockerfile', tag: 'Docker' },
  { file: '.env', tag: 'dotenv' },
  { file: '.nvmrc', tag: 'nvm' },
  { file: '.gitignore', tag: 'Git' },
  { file: 'README.md', tag: 'README' },
  { file: 'tsconfig.json', tag: 'TypeScript' },
];

// 包管理器锁文件
const PM_LOCK_RULES: { file: string; tag: PackageManager }[] = [
  { file: 'pnpm-lock.yaml', tag: 'pnpm' },
  { file: 'bun.lockb', tag: 'bun' },
  { file: 'bun.lock', tag: 'bun' },
  { file: 'yarn.lock', tag: 'yarn' },
  { file: 'package-lock.json', tag: 'npm' },
];

// ─── 识别器 ───────────────────────────────────────────────

export interface ScanInput {
  root_path: string;
  root_files: string[];      // 根目录文件名
  src_dirs: string[];        // src 下一级目录名（如果有 src）
  root_dirs: string[];       // 根目录下的目录名
  package_json?: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

function hasDep(pkg: ScanInput['package_json'], name: string): boolean {
  if (!pkg) return false;
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function hasFile(files: string[], name: string): boolean {
  return files.some((f) => f.toLowerCase() === name.toLowerCase());
}

function detectFramework(pkg: ScanInput['package_json']): Framework | undefined {
  for (const r of FRAMEWORK_RULES) {
    if (hasDep(pkg, r.pkg)) return r.tag;
  }
  return undefined;
}

function detectLanguage(pkg: ScanInput['package_json'], files: string[]): 'typescript' | 'javascript' | undefined {
  if (hasDep(pkg, 'typescript') || hasFile(files, 'tsconfig.json')) return 'typescript';
  if (hasDep(pkg, '@types/react') || hasDep(pkg, '@types/node')) return 'typescript';
  if (hasDep(pkg, 'react') || hasDep(pkg, 'vue')) return 'javascript';
  return undefined;
}

function detectCss(files: string[], pkg: ScanInput['package_json']): CssSolution | undefined {
  for (const r of CSS_FILE_RULES) {
    if (hasFile(files, r.file)) return r.tag as CssSolution;
  }
  for (const r of CSS_PKG_RULES) {
    if (hasDep(pkg, r.pkg)) return r.tag;
  }
  // 默认有 .css/.module.css 则视为 vanilla（不标记，由用户感知）
  return undefined;
}

function detectUILibs(pkg: ScanInput['package_json']): string[] {
  const libs: string[] = [];
  for (const r of UI_LIB_RULES) {
    if (hasDep(pkg, r.pkg) && !libs.includes(r.label)) libs.push(r.label);
  }
  // shadcn 是复制代码到项目里的，没有依赖包名。通过 components.json 判断
  if (pkg && hasFile(Object.keys(pkg).length ? [] : [], 'components.json')) {
    // 兜底在调用方传 root_files 后判定
  }
  return libs;
}

function detectStateMgmt(pkg: ScanInput['package_json']): string[] {
  const libs: string[] = [];
  for (const r of STATE_RULES) {
    if (hasDep(pkg, r.pkg) && !libs.includes(r.label)) libs.push(r.label);
  }
  return libs;
}

function detectBuildTool(files: string[], pkg: ScanInput['package_json']): BuildTool | undefined {
  for (const r of BUILD_FILE_RULES) {
    if (hasFile(files, r.file)) return r.tag as BuildTool;
  }
  if (hasDep(pkg, 'vite')) return 'vite';
  if (hasDep(pkg, 'webpack')) return 'webpack';
  if (hasDep(pkg, 'parcel')) return 'parcel';
  if (hasDep(pkg, 'rollup')) return 'rollup';
  if (hasDep(pkg, 'esbuild')) return 'esbuild';
  return undefined;
}

function detectPackageManager(files: string[]): PackageManager | undefined {
  for (const r of PM_LOCK_RULES) {
    if (hasFile(files, r.file)) return r.tag;
  }
  return undefined;
}

function detectStructure(rootDirs: string[], srcDirs: string[]): ProjectStructure {
  const lowerSrc = srcDirs.map((d) => d.toLowerCase());
  const lowerRoot = rootDirs.map((d) => d.toLowerCase());
  const hasSrc = lowerRoot.includes('src');
  return {
    has_src: hasSrc,
    has_components: lowerSrc.includes('components'),
    has_pages: lowerSrc.includes('pages') || lowerSrc.includes('views') || lowerSrc.includes('app'),
    has_hooks: lowerSrc.includes('hooks') || lowerSrc.includes('composables'),
    has_stores: lowerSrc.includes('stores') || lowerSrc.includes('store'),
    has_lib: lowerSrc.includes('lib') || lowerSrc.includes('utils'),
    has_tests: lowerRoot.includes('tests') || lowerRoot.includes('test') || lowerSrc.includes('__tests__'),
    has_assets: lowerSrc.includes('assets') || lowerSrc.includes('public') || lowerSrc.includes('static'),
    has_utils: lowerSrc.includes('utils') || lowerSrc.includes('helpers'),
    has_types: lowerSrc.includes('types') || lowerSrc.includes('typings') || lowerSrc.includes('@types'),
    src_layout: srcDirs,
    root_layout: rootDirs,
  };
}

function detectFeatures(pkg: ScanInput['package_json'], files: string[]): string[] {
  const feats = new Set<string>();
  for (const r of FEATURE_PKG_RULES) {
    if (hasDep(pkg, r.pkg)) feats.add(r.label);
  }
  for (const r of FEATURE_FILE_RULES) {
    if (hasFile(files, r.file)) feats.add(r.tag);
  }
  // shadcn 检测
  if (hasFile(files, 'components.json')) feats.add('shadcn/ui');
  return Array.from(feats);
}

function detectProjectType(framework: Framework | undefined, rootDirs: string[]): ProjectType {
  if (framework === 'next' || framework === 'nuxt' || framework === 'remix') return 'fullstack';
  const lower = rootDirs.map((d) => d.toLowerCase());
  if (lower.includes('server') || lower.includes('api') || lower.includes('backend')) return 'fullstack';
  if (framework) return 'frontend';
  return 'other';
}

function buildConventions(fp: Omit<ProjectFingerprint, 'conventions'>): string[] {
  const convs: string[] = [];
  if (fp.language === 'typescript') convs.push('使用 TypeScript，优先类型安全');
  if (fp.framework === 'react') convs.push('使用函数式组件 + Hooks');
  if (fp.framework === 'vue') convs.push('使用 Vue 单文件组件（SFC）');
  if (fp.css_solution === 'tailwind') convs.push('优先使用 Tailwind 原子类写样式');
  if (fp.css_solution === 'css-modules') convs.push('使用 CSS Modules 做样式隔离');
  if (fp.css_solution === 'styled-components') convs.push('使用 styled-components 写 CSS-in-JS');
  if (fp.ui_libraries.includes('shadcn/ui')) convs.push('优先复用 src/components/ui 下的 shadcn 组件');
  if (fp.state_management.includes('Zustand')) convs.push('全局状态用 Zustand，避免过度全局化');
  if (fp.package_manager === 'pnpm') convs.push('包管理器为 pnpm，新增依赖用 pnpm add');
  if (fp.structure.has_components) convs.push('UI 组件放在 src/components/ 目录');
  if (fp.structure.has_hooks) convs.push('可复用逻辑放在 src/hooks/');
  if (fp.structure.has_stores) convs.push('全局状态定义在 src/stores/');
  if (fp.structure.has_lib) convs.push('基础设施/工具函数放在 src/lib/');
  if (fp.build_tool === 'vite') convs.push('基于 Vite 构建，环境变量用 import.meta.env');
  return convs;
}

// ─── 主入口 ───────────────────────────────────────────────

export function analyzeFingerprint(input: ScanInput): ProjectFingerprint {
  const { root_path, root_files, src_dirs, root_dirs, package_json } = input;

  const framework = detectFramework(package_json);
  const language = detectLanguage(package_json, root_files);
  const css_solution = detectCss(root_files, package_json);
  const ui_libraries = detectUILibs(package_json);
  // shadcn 特殊处理
  if (hasFile(root_files, 'components.json') && !ui_libraries.includes('shadcn/ui')) {
    ui_libraries.push('shadcn/ui');
  }
  const state_management = detectStateMgmt(package_json);
  const build_tool = detectBuildTool(root_files, package_json);
  const package_manager = detectPackageManager(root_files);
  const structure = detectStructure(root_dirs, src_dirs);
  const detected_features = detectFeatures(package_json, root_files);
  const project_type = detectProjectType(framework, root_dirs);

  // 项目名：package.json 的 name 优先，否则用根目录名
  const name =
    package_json?.name ||
    root_path.split(/[/\\]/).filter(Boolean).pop() ||
    '未命名项目';

  const fp: Omit<ProjectFingerprint, 'conventions'> = {
    name,
    path: root_path,
    project_type,
    scanned_at: new Date().toISOString(),
    framework,
    language,
    css_solution,
    ui_libraries,
    state_management,
    build_tool,
    package_manager,
    detected_features,
    structure,
    package_json: package_json
      ? {
          name: package_json.name,
          version: package_json.version,
          dependencies: package_json.dependencies,
          dev_dependencies: package_json.devDependencies,
          scripts: package_json.scripts,
        }
      : undefined,
  };

  return {
    ...fp,
    conventions: buildConventions(fp),
  };
}

// 友好标签映射（用于 UI 展示）
export const FRAMEWORK_LABELS: Record<string, string> = {
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  angular: 'Angular',
  next: 'Next.js',
  nuxt: 'Nuxt',
  solid: 'SolidJS',
  preact: 'Preact',
  qwik: 'Qwik',
  astro: 'Astro',
  remix: 'Remix',
};

export const CSS_LABELS: Record<string, string> = {
  tailwind: 'Tailwind CSS',
  'css-modules': 'CSS Modules',
  'styled-components': 'styled-components',
  emotion: 'Emotion',
  sass: 'Sass/SCSS',
  less: 'Less',
  'vanilla-extract': 'Vanilla Extract',
  unocss: 'UnoCSS',
  vanilla: '原生 CSS',
};

export const BUILD_LABELS: Record<string, string> = {
  vite: 'Vite',
  webpack: 'Webpack',
  turbopack: 'Turbopack',
  rsbuild: 'Rspack/Rsbuild',
  parcel: 'Parcel',
  rollup: 'Rollup',
  esbuild: 'esbuild',
};

export const PM_LABELS: Record<string, string> = {
  pnpm: 'pnpm',
  yarn: 'Yarn',
  npm: 'npm',
  bun: 'Bun',
};

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  frontend: '前端项目',
  backend: '后端项目',
  fullstack: '全栈项目',
  mobile: '移动端',
  other: '其他',
};
