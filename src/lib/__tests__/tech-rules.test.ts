// src/lib/__tests__/tech-rules.test.ts
import { describe, it, expect } from 'vitest';
import { analyzeFingerprint, type ScanInput } from '../tech-rules';

function makeInput(overrides: Partial<ScanInput> = {}): ScanInput {
  return {
    root_path: '/tmp/test',
    root_files: [],
    src_dirs: [],
    root_dirs: [],
    package_json: undefined,
    ...overrides,
  };
}

describe('analyzeFingerprint 框架识别', () => {
  it('React 项目', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { react: '^18.3.0' } },
    }));
    expect(fp.framework).toBe('react');
    expect(fp.project_type).toBe('frontend');
  });

  it('Next.js 项目识别为 fullstack', () => {
    const fp = analyzeFingerprint(makeInput({
      root_dirs: ['src', 'app', 'public'],
      package_json: { dependencies: { next: '^14.0.0', react: '^18.3.0' } },
    }));
    expect(fp.framework).toBe('next');
    expect(fp.project_type).toBe('fullstack');
  });

  it('Vue 项目', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { vue: '^3.4.0' } },
    }));
    expect(fp.framework).toBe('vue');
  });

  it('无框架时 project_type 为 other', () => {
    const fp = analyzeFingerprint(makeInput());
    expect(fp.framework).toBeUndefined();
    expect(fp.project_type).toBe('other');
  });
});

describe('analyzeFingerprint 语言识别', () => {
  it('有 TypeScript 依赖时识别为 typescript', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { devDependencies: { typescript: '^5.4.0' } },
    }));
    expect(fp.language).toBe('typescript');
  });

  it('有 tsconfig.json 时识别为 typescript', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['tsconfig.json'],
    }));
    expect(fp.language).toBe('typescript');
  });

  it('仅有 React 无 TS 时识别为 javascript', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { react: '^18.3.0' } },
    }));
    expect(fp.language).toBe('javascript');
  });
});

describe('analyzeFingerprint CSS 方案识别', () => {
  it('Tailwind 通过配置文件识别', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['tailwind.config.ts'],
    }));
    expect(fp.css_solution).toBe('tailwind');
  });

  it('Tailwind 通过依赖识别', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: {} },
      root_files: ['tailwind.config.js'],
    }));
    expect(fp.css_solution).toBe('tailwind');
  });

  it('styled-components 识别', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { 'styled-components': '^6.0.0' } },
    }));
    expect(fp.css_solution).toBe('styled-components');
  });
});

describe('analyzeFingerprint 状态管理识别', () => {
  it('Zustand 识别', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { zustand: '^4.5.0' } },
    }));
    expect(fp.state_management).toContain('Zustand');
  });

  it('Redux Toolkit 识别', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { '@reduxjs/toolkit': '^2.0.0' } },
    }));
    expect(fp.state_management).toContain('Redux Toolkit');
  });

  it('无状态管理时为空数组', () => {
    const fp = analyzeFingerprint(makeInput());
    expect(fp.state_management).toEqual([]);
  });
});

describe('analyzeFingerprint 构建工具识别', () => {
  it('Vite 通过配置文件识别', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['vite.config.ts'],
    }));
    expect(fp.build_tool).toBe('vite');
  });

  it('Webpack 通过配置文件识别', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['webpack.config.js'],
    }));
    expect(fp.build_tool).toBe('webpack');
  });
});

describe('analyzeFingerprint 包管理器识别', () => {
  it('pnpm 通过 lock 文件识别', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['pnpm-lock.yaml'],
    }));
    expect(fp.package_manager).toBe('pnpm');
  });

  it('yarn 通过 lock 文件识别', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['yarn.lock'],
    }));
    expect(fp.package_manager).toBe('yarn');
  });

  it('bun 通过 lock 文件识别', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['bun.lockb'],
    }));
    expect(fp.package_manager).toBe('bun');
  });
});

describe('analyzeFingerprint 目录结构识别', () => {
  it('有 src/components 时 has_components 为 true', () => {
    const fp = analyzeFingerprint(makeInput({
      root_dirs: ['src'],
      src_dirs: ['components', 'hooks', 'lib'],
    }));
    expect(fp.structure.has_src).toBe(true);
    expect(fp.structure.has_components).toBe(true);
    expect(fp.structure.has_hooks).toBe(true);
    expect(fp.structure.has_lib).toBe(true);
  });

  it('无 src 目录时 has_src 为 false', () => {
    const fp = analyzeFingerprint(makeInput({
      root_dirs: ['app', 'public'],
    }));
    expect(fp.structure.has_src).toBe(false);
  });
});

describe('analyzeFingerprint 特性检测', () => {
  it('检测 ESLint', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['eslint.config.js'],
    }));
    expect(fp.detected_features).toContain('ESLint');
  });

  it('检测 Vitest', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { devDependencies: { vitest: '^1.6.0' } },
    }));
    expect(fp.detected_features).toContain('Vitest');
  });

  it('检测 shadcn/ui', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['components.json'],
    }));
    expect(fp.detected_features).toContain('shadcn/ui');
  });
});

describe('analyzeFingerprint 约束生成', () => {
  it('React + TypeScript + Tailwind 项目生成对应约束', () => {
    const fp = analyzeFingerprint(makeInput({
      root_files: ['tailwind.config.ts', 'tsconfig.json'],
      root_dirs: ['src'],
      src_dirs: ['components', 'hooks', 'stores'],
      package_json: {
        dependencies: { react: '^18.3.0' },
        devDependencies: { typescript: '^5.4.0' },
      },
    }));
    expect(fp.conventions).toContain('使用 TypeScript，优先类型安全');
    expect(fp.conventions).toContain('使用函数式组件 + Hooks');
    expect(fp.conventions).toContain('优先使用 Tailwind 原子类写样式');
    expect(fp.conventions.some((c) => c.includes('src/components'))).toBe(true);
    expect(fp.conventions.some((c) => c.includes('src/hooks'))).toBe(true);
    expect(fp.conventions.some((c) => c.includes('src/stores'))).toBe(true);
  });
});

describe('analyzeFingerprint 项目名提取', () => {
  it('从 package.json name 提取', () => {
    const fp = analyzeFingerprint(makeInput({
      root_path: '/tmp/some-path',
      package_json: { name: 'my-app' },
    }));
    expect(fp.name).toBe('my-app');
  });

  it('无 package.json 时从路径提取', () => {
    const fp = analyzeFingerprint(makeInput({
      root_path: '/tmp/my-project',
    }));
    expect(fp.name).toBe('my-project');
  });
});

describe('analyzeFingerprint UI 组件库识别', () => {
  it('Ant Design', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { antd: '^5.0.0' } },
    }));
    expect(fp.ui_libraries).toContain('Ant Design');
  });

  it('MUI', () => {
    const fp = analyzeFingerprint(makeInput({
      package_json: { dependencies: { '@mui/material': '^5.0.0' } },
    }));
    expect(fp.ui_libraries).toContain('MUI');
  });
});
