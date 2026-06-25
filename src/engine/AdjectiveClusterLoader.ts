// src/engine/AdjectiveClusterLoader.ts
// 形容词簇加载器：从 adjective-clusters.yaml 加载 + 缓存
import { parse as parseYaml } from 'yaml';
import type { AdjectiveCluster, AdjectiveClusterConfig } from './types';
import clustersYamlText from '@/question-bank/adjective-clusters.yaml?raw';

let cachedConfig: AdjectiveClusterConfig | null = null;
let cachedClustersById: Map<string, AdjectiveCluster> | null = null;

/** 获取形容词簇配置（懒加载） */
export function getAdjectiveClusterConfig(): AdjectiveClusterConfig {
  if (cachedConfig) return cachedConfig;
  const obj = parseYaml(clustersYamlText) as AdjectiveClusterConfig;
  if (!obj || !Array.isArray(obj.clusters)) {
    throw new Error('[AdjectiveClusterLoader] YAML 解析失败或 clusters 不是数组');
  }
  if (obj.schema_version !== '1.0') {
    throw new Error(`[AdjectiveClusterLoader] schema_version 不匹配，期望 1.0 实际 ${obj.schema_version}`);
  }
  // 完整性校验
  const idSet = new Set<string>();
  for (const c of obj.clusters) {
    if (!c.id || !Array.isArray(c.surface_forms)) {
      throw new Error(`[AdjectiveClusterLoader] 簇缺少 id 或 surface_forms: ${JSON.stringify(c)}`);
    }
    if (idSet.has(c.id)) {
      throw new Error(`[AdjectiveClusterLoader] 簇 ID 重复: ${c.id}`);
    }
    idSet.add(c.id);
  }
  cachedConfig = obj;
  cachedClustersById = new Map(obj.clusters.map((c) => [c.id, c]));
  return obj;
}

/** 按 ID 取单个簇 */
export function getAdjectiveClusterById(id: string): AdjectiveCluster | undefined {
  if (!cachedClustersById) getAdjectiveClusterConfig();
  return cachedClustersById!.get(id);
}

/** 取所有簇（供引擎遍历匹配） */
export function getAllAdjectiveClusters(): AdjectiveCluster[] {
  return getAdjectiveClusterConfig().clusters;
}

/** 测试用：重置缓存 */
export function _resetAdjectiveClusterCache(): void {
  cachedConfig = null;
  cachedClustersById = null;
}
