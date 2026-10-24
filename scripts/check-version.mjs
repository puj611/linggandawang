#!/usr/bin/env node
/**
 * check-version.mjs — 版本号一致性校验脚本
 *
 * 比对以下四处版本号是否一致：
 *   1. package.json              的 version
 *   2. src-tauri/tauri.conf.json 的 version
 *   3. src-tauri/Cargo.toml      [package] 段下的 version
 *   4. CHANGELOG.md              首个 `## [x.y.z]` 条目中的版本号
 *
 * 全部一致：打印 `OK: version <v> consistent across 4 locations`，退出码 0；
 * 任一不一致：逐项打印实际值，退出码 1。
 *
 * 零第三方依赖，仅使用 node:fs / node:path / node:url。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 项目根目录：本脚本位于 <root>/scripts/ 下，向上一级即仓库根。
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 读取 package.json 的 version 字段。
 * @returns {string} 版本号，缺失时返回空串。
 */
function readPackageJsonVersion() {
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  return String(pkg.version ?? '');
}

/**
 * 读取 src-tauri/tauri.conf.json 的 version 字段。
 * @returns {string} 版本号，缺失时返回空串。
 */
function readTauriConfVersion() {
  const conf = JSON.parse(readFileSync(path.join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  return String(conf.version ?? '');
}

/**
 * 从 Cargo.toml 的 [package] 段提取 version（行级简易解析，避免引入 TOML 依赖）。
 * @returns {string} 版本号，未找到时返回空串。
 */
function readCargoTomlVersion() {
  const text = readFileSync(path.join(projectRoot, 'src-tauri/Cargo.toml'), 'utf8');
  let inPackageSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      // 进入/离开段：仅 [package] 段内的 version 才算数。
      inPackageSection = line === '[package]';
      continue;
    }
    if (inPackageSection) {
      const match = line.match(/^version\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    }
  }
  return '';
}

/**
 * 提取 CHANGELOG.md 中首个 `## [x.y.z]` 条目括号内的版本号。
 * @returns {string} 版本号，未找到时返回空串。
 */
function readChangelogFirstVersion() {
  const text = readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
  const match = text.match(/^##\s*\[([^\]]+)\]/m);
  return match ? match[1] : '';
}

// 收集四处版本号（顺序即报告顺序）。
const locations = [
  { name: 'package.json', value: readPackageJsonVersion() },
  { name: 'src-tauri/tauri.conf.json', value: readTauriConfVersion() },
  { name: 'src-tauri/Cargo.toml', value: readCargoTomlVersion() },
  { name: 'CHANGELOG.md (first entry)', value: readChangelogFirstVersion() },
];

const expected = locations[0].value;
const consistent = locations.every((loc) => loc.value !== '' && loc.value === expected);

if (consistent) {
  console.log(`OK: version ${expected} consistent across ${locations.length} locations`);
  process.exit(0);
}

console.error('FAIL: version mismatch across locations:');
for (const loc of locations) {
  console.error(`  ${loc.name}: ${loc.value || '(not found)'}`);
}
process.exit(1);
