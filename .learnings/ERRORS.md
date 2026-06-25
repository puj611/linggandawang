# Errors

Command failures and integration errors.

---

## [ERR-20260624-001] tauri-dialog-permission

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: config

### Summary
Tauri v2 权限名 dialog:allow-pick-folder 不存在，正确名是 dialog:allow-open

### Error
capabilities/default.json 中使用了不存在的权限名导致文件夹选择功能失败

### Context
- Command/operation attempted: 文件夹选择功能
- Input or parameters used: capabilities/default.json 中配置 dialog:allow-pick-folder

### Suggested Fix
使用 dialog:allow-open

### Metadata
- Source: error
- Related Files: src-tauri/capabilities/default.json
- Tags: tauri, permissions, dialog, tauri-v2

---

## [ERR-20260624-002] question-loader-schema

**Logged**: 2026-06-24T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
QuestionLoader 中硬编码校验 schema_version === '1.0'，修改 bank.yaml 版本号后导致加载失败

### Error
schema_version 不匹配导致问题库无法加载

### Context
- Command/operation attempted: 加载问题库
- Input or parameters used: bank.yaml 中 schema_version 字段

### Suggested Fix
使用宽松版本校验或 semver 比较

### Metadata
- Source: error
- Tags: question-loader, schema-version, bank-yaml, versioning

---
