# 大审查报告 — 灵感大王（2026-08-21 核心模块）

## 0 概览

| 项 | 值 |
|---|---|
| 范围 | 核心业务模块抽样：Rust 后端（llm_proxy/updater/image/project）、前端 lib（llm/vectorStore/sqlite）、hooks 编排层、engine 层、MCP server、capabilities/CSP |
| 文件数/行数 | 16 个核心文件 / 4,836 行（含全量 grep 扫描 XSS 面、lint、373 测试） |
| 基线 | AGENTS.md + docs/reference/ 4 份接口文档，齐全 |
| 技术栈 | Tauri 2.x + React 18 + TS strict + Zustand + SQLite + minisign 更新链 |
| 工作区状态 | 未提交改动 0 行（git status 的 M 为 CRLF 行尾误报） |
| 总体风险 | 中 |
| 一句话结论 | 工程质量整体扎实（竞态防护、密钥代理、最小权限是亮点），但 SSRF 防护存在一个可绕过的 IPv4-mapped IPv6 缺口，加上两处数据可靠性缺陷，无危急项。 |

无【危急】项。

## 1 问题清单（严重度降序）

### P1【高】[B] SSRF 校验可被 IPv4-mapped IPv6 绕过

- 位置：src-tauri/src/commands/llm_proxy.rs:68-75
- 证据：
  ```rust
  IpAddr::V6(v6) => {
      v6.is_loopback()
          || v6.is_unique_local()
          || v6.is_unicast_link_local()
          || v6.is_unspecified()
  }
  ```
- 触发路径：配置 `base_url = "https://[::ffff:127.0.0.1]:8080"` 或 `https://[::ffff:192.168.1.5]:8080` → `lookup_host` 解析出 `::ffff:7f00:1` → 四个判断全为 false（Rust std 的 `is_loopback()` 只认 `::1`）→ 校验放行 → reqwest 连接 `::ffff:127.0.0.1` ≡ 本机回环，携 `Authorization: Bearer <key>` 访问本机任意服务。同理 NAT64 段 `64:ff9b::/96` 可映射访问任意内网 IPv4。
- 最坏影响：SSRF 防护整体失效——密钥被注入到本机/内网任意监听服务；云环境可打 169.254.169.254 元数据端点。
- 修复建议（成本：低）：
  ```rust
  IpAddr::V6(v6) => {
      if let Some(v4) = v6.to_ipv4_mapped() {
          return is_private_ip(IpAddr::V4(v4));
      }
      v6.is_loopback()
          || v6.is_unique_local()
          || v6.is_unicast_link_local()
          || v6.is_unspecified()
          || (v6.segments()[0] == 0x64 && v6.segments()[1] == 0xff9b)
  }
  ```
  并补单测：`::ffff:127.0.0.1` / `::ffff:10.0.0.1` / `64:ff9b::7f00:1`。
- 附带：`validate_ssrf` 校验与 `send()` 各自 DNS 解析存在 TOCTOU（DNS rebinding）窗口，彻底修复需自定义 resolver 钉住 IP；利用前提是攻击者控制权威 DNS，登记为已知残余风险。

### P2【中】[A] 向量存储持久化 DELETE+INSERT 无事务

- 位置：src/lib/vectorStore.ts:227-245
- 证据：`await executeSql('DELETE FROM vector_store')` 后循环分批 INSERT（每批 40 行），每条语句独立提交。
- 触发路径：第 2 批 INSERT 失败（进程被杀/磁盘满/SQLite 锁）→ DELETE 已生效、新数据只写入一半。
- 最坏影响：RAG 历史向量全量或部分丢失；下次启动 restore 读到残缺数据。可由后续 QA 重建。
- 修复建议（成本：低）：staging 表方案——先全量写 `vector_store_staging`，成功后 `DROP` 原表 + `RENAME`，任何一步失败原表完好。

### P3【中】[D] MCP stdio 无 payload 大小限制

- 位置：mcp-server/index.ts:51-54
- 证据：`createInterface` 逐行读入，`JSON.parse` 前无行长检查。
- 触发路径：恶意进程以 stdio 挂载本 server 发送单行超大 JSON → 内存占用直至 OOM。
- 最坏影响：本地 DoS。正常调用方是 Claude Code/Cursor（受信），暴露面小。
- 修复建议（成本：低）：行长 > 1MB 直接回 Parse error 并丢弃。

### P4【中】[E] updater endpoint 仍是占位符

- 位置：src-tauri/tauri.conf.json:61 `"https://github.com/puj611/linggandawang/..."`
- 影响：打 tag 发版后所有客户端 check() 404 → 更新链路静默失败，v0.1.0 用户收不到更新（含安全补丁）。
- 修复建议（成本：低）：推送 GitHub 前替换真实用户名。本迭代必办。

### P5【低】[A] `Object.keys(allAnswers).pop()` 取"最后答案"依赖插入顺序

- 位置：src/hooks/useFlow.ts:370
- 触发路径：goBack 撤销后重答同一题——key 语义需确认。
- 验证方法：单测构造 goBack→重答场景断言 `recordAnswer` 收到的对象。
- 修复建议：`engine.answer` 直接返回被记录的 answer 对象。

### P6【低】[C] markdown 注释无转义

- 位置：src/engine/PromptGenerator.ts:173、210-216
- 触发路径：用户输入含 `-->` 提前闭合注释；含 markdown 语法注入段落。
- 影响：前端已确认全量无 `dangerouslySetInnerHTML`（grep 0 命中），React 文本节点自动转义，无 XSS；仅影响导出 .md 结构，及 MCP 下游 LLM 的理论 prompt injection 面。
- 修复建议（成本：低）：`raw_quote.replace(/-->/g, '--\\>')`。

### P7【低】[B] Rust 侧脱敏只覆盖 "Bearer " 前缀

- 位置：src-tauri/src/commands/llm_proxy.rs:114-116
- 影响：若 LLM 端点错误体回显裸 key（`sk-...`）不脱敏。回显场景罕见。
- 修复建议（成本：低）：正则替换 `sk-[A-Za-z0-9]{20,}` 为 `sk-***`。

### P8【低】[D] chatViaProxy 竞速的 abort 监听器不清理

- 位置：src/lib/llm/openai-adapter.ts:265-278
- 影响：race 结束后监听器残留（once:true + signal 短生命周期，实际泄漏可忽略）。
- 修复建议（成本：低）：finally 中 removeEventListener，纯防御性。

### P9【低】[C] lint 债：39 处 `any` warning

- 位置：集中于 sqlite.ts（AGENTS.md 已登记为已知坑 #2）、测试文件、withRetry。
- 修复建议：测试文件加文件级 eslint-disable；sqlite.ts 保持现状。

### P10【低】[A] protocol.ts 通知发 initialize 返回无 id 响应

- 位置：mcp-server/protocol.ts:75 `req.id!` 非空断言。
- 影响：notification 形式的 initialize 得到丢 id 字段的响应，标准客户端按通知丢弃。无实际危害。

## 2 统计

| 严重度\类别 | A Bug | B 安全 | C 质量 | D 性能 | E 架构 |
|---|---|---|---|---|---|
| 危急 | 0 | 0 | 0 | 0 | 0 |
| 高 | 0 | 1 (P1) | 0 | 0 | 0 |
| 中 | 1 (P2) | 0 | 0 | 1 (P3) | 1 (P4) |
| 低 | P5, P10 | P7 | P6, P9 | P8 | 0 |

质量评分：82/100。主要扣分：SSRF 绕过 -8、无事务持久化 -3、MCP DoS -3、lint 债 -2、updater 占位符 -2。

## 3 亮点

1. 竞态防护成体系：startSeq 代际守卫 + mountedRef + resize/drag 互斥锁 + stale timeout 兜底，每个修复点带编号注释溯源
2. 密钥零前端明文：Rust keyring 注入 + 错误脱敏 + 代理调用
3. 最小权限落地扎实：SQL 权限锁定单库文件、零 fs 权限、CSP 无 https: 通配
4. SSRF 意识到位：内网段覆盖全面（CGNAT/IETF/文档段都有单测断言）
5. 373 测试全绿（审查时实跑验证），引擎层纯函数可独立测试

## 4 修复计划

| 批次 | 问题 | 成本 | 可自动化 |
|---|---|---|---|
| 立即修复 | P1 SSRF IPv4-mapped（5 行 + 3 单测） | 低 | 是 |
| 立即修复 | P4 updater 占位符（需 GitHub 用户名） | 低 | 半自动 |
| 本迭代 | P2 持久化原子性、P3 MCP 行长限制 | 低 | 是 |
| backlog | P5~P10 | 低 | P6/P7/P8 可批量 |

## 5 需人工确认项

| 问题 | 验证手段 |
|---|---|
| P5 Object.keys().pop() 重答语义 | 单测：goBack 后重答，断言 recordAnswer 入参 |
| P1 TOCTOU 残余风险是否接受 | 评估威胁模型：攻击者需同时控制 baseUrl 配置与权威 DNS |
| dev 模式 localhost:8080 白名单与 Rust 校验一致性 | 实测 Rust 放行 localhost:8080 后 CSP connect-src 同步情况 |

## 6 沉淀建议（追加到 AGENTS.md 已知坑点）

1. `is_private_ip` 对 IPv6 必须先 `to_ipv4_mapped()` 还原再判——`::ffff:127.0.0.1` 的 `is_loopback()` 为 false，是 Rust std 的反直觉行为
2. tauri-plugin-sql 的 `execute` 每条独立提交，无跨语句事务；需要原子性时用 staging 表 + RENAME，不要 DELETE+INSERT 裸奔
3. MCP stdio server 必须限制单行长度并只向 stdout 写协议消息

## 审查执行记录

- 范围确定：git status M 为 CRLF 误报（diff 0 行），实际范围 = 核心模块抽样
- 基线：AGENTS.md 全文 + docs/reference/ 4 份文档
- 方法：4 个并行子代理定位线索 + 主审亲自交叉验证关键点 + 工具增强（eslint、vitest 373 全绿、grep XSS 面 0 命中）
