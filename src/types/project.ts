// src/types/project.ts
// 项目指纹类型：通过扫描项目目录识别技术栈/结构/约定

export type ProjectType = 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'other';

export type Framework =
  | 'react' | 'vue' | 'svelte' | 'angular'
  | 'next' | 'nuxt' | 'solid' | 'preact'
  | 'qwik' | 'astro' | 'remix';

export type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

export type CssSolution =
  | 'tailwind' | 'css-modules' | 'styled-components'
  | 'emotion' | 'sass' | 'less' | 'vanilla-extract'
  | 'unocss' | 'vanilla';

export type BuildTool = 'vite' | 'webpack' | 'turbopack' | 'rsbuild' | 'parcel' | 'rollup' | 'esbuild';

export type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

export interface ProjectStructure {
  has_src: boolean;
  has_components: boolean;
  has_pages: boolean;
  has_hooks: boolean;
  has_stores: boolean;
  has_lib: boolean;
  has_tests: boolean;
  has_assets: boolean;
  has_utils: boolean;
  has_types: boolean;
  src_layout: string[];
  root_layout: string[];
}

export interface ProjectFingerprint {
  name: string;
  path: string;
  project_type: ProjectType;
  scanned_at: string;

  framework?: Framework;
  language?: Language;
  css_solution?: CssSolution;
  ui_libraries: string[];
  state_management: string[];
  build_tool?: BuildTool;
  package_manager?: PackageManager;

  conventions: string[];
  detected_features: string[];
  structure: ProjectStructure;

  package_json?: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    dev_dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

export const EMPTY_FINGERPRINT: ProjectFingerprint = {
  name: '',
  path: '',
  project_type: 'other',
  scanned_at: '',
  ui_libraries: [],
  state_management: [],
  conventions: [],
  detected_features: [],
  structure: {
    has_src: false,
    has_components: false,
    has_pages: false,
    has_hooks: false,
    has_stores: false,
    has_lib: false,
    has_tests: false,
    has_assets: false,
    has_utils: false,
    has_types: false,
    src_layout: [],
    root_layout: [],
  },
};
