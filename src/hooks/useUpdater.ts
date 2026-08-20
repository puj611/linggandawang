// src/hooks/useUpdater.ts
// Task 18：应用自动更新 hook
// 降级方案说明：node_modules 缺 @tauri-apps/plugin-updater / @tauri-apps/plugin-process
// JS 绑定包且 npm 不可用，故不走插件官方 JS API，而是经 invoke 调用
// src-tauri/src/commands/updater.rs 中的自定义 Rust 命令封装 updater API。
// 签名密钥（pubkey）未配置、latest.json 不存在或网络失败时全部静默降级（console.warn），
// 不影响主流程。

import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@/lib/env';

export interface UpdateInfo {
  /** 新版本号 */
  version: string;
  /** 更新说明（latest.json 的 notes 字段） */
  notes: string | null;
}

export type UpdaterStatus =
  | 'idle' // 初始态
  | 'checking' // 检查中
  | 'available' // 有可用更新
  | 'up-to-date' // 已是最新
  | 'downloading' // 下载安装中
  | 'error'; // 检查/安装失败（已静默）

/** updater_check 命令返回结构（见 src-tauri/src/commands/updater.rs） */
interface UpdaterCheckResult {
  available: boolean;
  version: string | null;
  notes: string | null;
  current_version: string;
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  /** 挂载时加载当前应用版本（getVersion 读 tauri.conf.json 的 version） */
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((v) => setCurrentVersion(v))
      .catch((e) => console.warn('[updater] 获取当前版本失败：', e));
  }, []);

  /**
   * 检查更新
   * @returns 有更新时返回 {version, notes}；无更新或失败（含非 Tauri 环境）返回 null
   */
  const checkForUpdates = useCallback(async (): Promise<UpdateInfo | null> => {
    if (!isTauri()) return null;
    setStatus('checking');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<UpdaterCheckResult>('updater_check');
      if (res.available && res.version) {
        const info: UpdateInfo = { version: res.version, notes: res.notes };
        setUpdateInfo(info);
        setStatus('available');
        return info;
      }
      setUpdateInfo(null);
      setStatus('up-to-date');
      return null;
    } catch (e) {
      // pubkey 未配置 / latest.json 不存在 / 网络失败等场景
      console.warn('[updater] 检查更新失败：', e);
      setStatus('error');
      return null;
    }
  }, []);

  /**
   * 下载并安装更新，安装完成后应用自动重启（Rust 端 downloadAndInstall + restart）
   * @returns 是否成功发起安装（正常情况下安装后应用重启，不会走到返回）
   */
  const downloadAndInstall = useCallback(async (): Promise<boolean> => {
    if (!isTauri()) return false;
    setStatus('downloading');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('updater_download_and_install');
      return true;
    } catch (e) {
      console.warn('[updater] 下载安装更新失败：', e);
      setStatus('error');
      return false;
    }
  }, []);

  return { status, updateInfo, currentVersion, checkForUpdates, downloadAndInstall };
}
