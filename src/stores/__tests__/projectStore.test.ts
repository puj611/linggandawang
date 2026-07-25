// src/stores/__tests__/projectStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';

describe('useProjectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      fingerprint: null,
      fullScanResult: null,
      loaded: false,
      scanning: false,
      error: null,
    });
  });

  it('初始状态', () => {
    const state = useProjectStore.getState();
    expect(state.fingerprint).toBeNull();
    expect(state.fullScanResult).toBeNull();
    expect(state.loaded).toBe(false);
    expect(state.scanning).toBe(false);
    expect(state.error).toBeNull();
  });

  it('setScanning 切换扫描状态', () => {
    useProjectStore.getState().setScanning(true);
    expect(useProjectStore.getState().scanning).toBe(true);
    useProjectStore.getState().setScanning(false);
    expect(useProjectStore.getState().scanning).toBe(false);
  });

  it('setError 设置错误信息', () => {
    useProjectStore.getState().setError('测试错误');
    expect(useProjectStore.getState().error).toBe('测试错误');
    useProjectStore.getState().setError(null);
    expect(useProjectStore.getState().error).toBeNull();
  });

  it('setFullScanResult 设置深度扫描结果', () => {
    const mockResult = {
      file_tree: { root: '/tmp', total_files: 10, total_dirs: 2, total_size: 1000, entries: [], by_extension: {} },
      git: { is_repo: false, changed_files: [], recent_commits: [] },
      dependencies: { dependencies: {}, dev_dependencies: {}, scripts: {} },
      todos: [],
      scan_time_ms: 100,
    };
    useProjectStore.getState().setFullScanResult(mockResult);
    expect(useProjectStore.getState().fullScanResult).toEqual(mockResult);
  });

  it('setFullScanResult(null) 清除扫描结果', () => {
    const mockResult = {
      file_tree: { root: '/tmp', total_files: 10, total_dirs: 2, total_size: 1000, entries: [], by_extension: {} },
      git: { is_repo: false, changed_files: [], recent_commits: [] },
      dependencies: { dependencies: {}, dev_dependencies: {}, scripts: {} },
      todos: [],
      scan_time_ms: 100,
    };
    useProjectStore.getState().setFullScanResult(mockResult);
    expect(useProjectStore.getState().fullScanResult).not.toBeNull();
    useProjectStore.getState().setFullScanResult(null);
    expect(useProjectStore.getState().fullScanResult).toBeNull();
  });
});

describe('useHasProject（通过 selector 验证）', () => {
  it('无 fingerprint 时 hasProject 为 false', () => {
    useProjectStore.setState({ fingerprint: null });
    const fp = useProjectStore.getState().fingerprint;
    expect(!!fp && !!fp.path).toBe(false);
  });

  it('有 fingerprint 但无 path 时 hasProject 为 false', () => {
    useProjectStore.setState({
      fingerprint: {
        name: 'test', path: '', project_type: 'other', scanned_at: '',
        ui_libraries: [], state_management: [], conventions: [], detected_features: [],
        structure: { has_src: false, has_components: false, has_pages: false, has_hooks: false, has_stores: false, has_lib: false, has_tests: false, has_assets: false, has_utils: false, has_types: false, src_layout: [], root_layout: [] },
      },
    });
    const fp = useProjectStore.getState().fingerprint;
    expect(!!fp && !!fp.path).toBe(false);
  });

  it('有 fingerprint + path 时 hasProject 为 true', () => {
    useProjectStore.setState({
      fingerprint: {
        name: 'test', path: '/tmp/test', project_type: 'frontend', scanned_at: '',
        ui_libraries: [], state_management: [], conventions: [], detected_features: [],
        structure: { has_src: true, has_components: true, has_pages: false, has_hooks: false, has_stores: false, has_lib: false, has_tests: false, has_assets: false, has_utils: false, has_types: false, src_layout: ['components'], root_layout: ['src'] },
      },
    });
    const fp = useProjectStore.getState().fingerprint;
    expect(!!fp && !!fp.path).toBe(true);
  });
});
