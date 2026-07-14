---
name: coreclaw-cli-audit
description: >
  Audit coreclaw-cli validation rules against the official CoreClaw
  platform documentation. Use when checking if CLI schema validation,
  project structure checks, SDK dependency checks, or API parameter
  format checks are complete and correct per the platform contract.
  Trigger on: "audit", "check compliance", "validate against docs",
  "find gaps", "docs contract", "platform contract".
---

# CoreClaw CLI 审计 Skill

## 概述

持续审计 coreclaw-cli 的校验逻辑，确保与官方文档契约一致。

**关键路径（相对于仓库根目录）：**
- 校验逻辑：`src/validation/schema.js`、`src/validation/project.js`
- 测试文件：`test/schema.test.js`、`test/project.test.js`
- 本 skill：`.coreclaw/skills/coreclaw-cli-audit/`

**官方文档路径（需配合 docs 仓库）：**
- 输入 schema：`developer-guide/worker-definition/input-schema.md`
- 输出 schema：`developer-guide/worker-definition/output-schema.md`
- 项目结构：`developer-guide/worker-definition/project-structure.md`
- SDK 模块：`developer-guide/worker-definition/sdk-modules.md`
- API 调用：`api/worker/run.mdx`、`api/integration.md`
- 平台特性：`developer-guide/worker-definition/platform-features/*.md`

**并发规则补充来源：**
- 当前规则 HTML：`C:/Users/user/Desktop/urls/最新脚本并发拆分规则说明.html`（2026-07 版，含 limits）
- 本仓库摘录：`skills/coreclaw-cli-audit/references/concurrency-rules.md`

## 审计流程

### Phase 1: 规则提取

对每个文档页面，提取可机器校验的规则：

- "must" / "required" / "shall" → 校验规则
- "type must be" / "editor" → 类型约束
- "error" / "reject" / "400" / "Invalid" → 平台拒绝条件
- JSON 示例中的结构 → schema shape 约束
- 表格中的字段定义 → 必填/可选/类型/枚举
- 并发拆分示例 → `concurrency.fields`、`remove_fields`、旧版 `b` 回退、空值过滤和 split 结果形状约束

> **提取时的防错原则**：文档写 "Required=Yes" 或 "must" 不等于平台会硬拒。只能把规则记为"待验证"，不能直接定为 `error`。2026-06-17 的 "code 4000" 错误就是把文档里的 "must" 直接当 error，结果 2026-07-13 实测发现平台根本不拒绝。先提取，后验证。

### Phase 2: 平台验证（gate，防止误定 severity）

**任何想把规则标为 `error`（平台硬拒）的判断，必须先有 `examples/verify-*` 探针实测。** 没有 `error` 能跳过这一步。

- 探针放在 `examples/verify-<topic>/`，是一个能上传平台、能跑出结果的最小 worker。
- 探针 README 记录：输入、输出、平台是否接受/拒绝、真实 code 和 message。
- 探针结果回填到 `references/known-gaps.md` 对应条目 + `contract-checklist.md` 规则行的括注。
- 验证状态标记：`⏳ 待验证` → 实测后改 `✅ Resolved` 或 `⚠️ 实测推翻`。
- 已闭环的探针（如 `verify-code4000`、`verify-required-fields`）保留为回归 artifact，README 改为 RESOLVED。

验证后的 severity 判定：
- 平台 upload 或运行时**硬拒**（返回非 0 code 或 HTTP 4xx/5xx 且不运行）→ `error`
- 平台接受但**表单/运行可能异常**（如 T7 checkbox 选项无法选中）→ `warn`
- 平台接受且无异常 → 不校验或仅 `info`

### Phase 3: 代码比对

对每条已验证的规则，检查：
1. `src/validation/schema.js` 是否有对应的校验函数
2. `src/runtime/input.js` 是否正确模拟本地 `--split` 运行时行为
3. `src/cloud/client.js` 的方法是否覆盖 openapi spec 的 operationId（运行 `node skills/coreclaw-cli-audit/scripts/diff-contract.cjs`）
4. severity 是否与 Phase 2 实测结论一致（平台拒绝 = `error`，平台接受但表单/运行可能异常 = `warn`）
5. 错误消息是否包含修复建议（不要写 "code 4000"——平台实测不拒绝 editor/type 不匹配，且该码不在 error-codes.md）
6. `test/schema.test.js` 是否有对应的测试用例

特别注意：`b` 已不是必填字段。新规则优先 `concurrency.fields`，没有有效新规则时才回退旧版 `b`。审计时不要把缺少 `b` 当作错误。

### Phase 4: 缺口报告

输出格式：
- `[ERROR]` 规则 X 在文档中定义但 CLI 未校验
- `[WARN]`  规则 Y 的 severity 应为 error 但当前是 warn（须有 Phase 2 实测支撑）
- `[VERIFY]` 规则 Z 标为 error 但无 `examples/verify-*` 探针 → 必须补探针
- `[OK]`    规则 Z 已正确实现并有测试覆盖

### Phase 5: 修复

对每个 ERROR/WARN/VERIFY：
1. 在 `schema.js` 或 `project.js` 中实现修复
2. 在 `schema.test.js` 或 `project.test.js` 中补充测试
3. 若规则标为 `error` 但无探针 → 先补 `examples/verify-<topic>/` 探针，等平台实测后再定 severity（不得仅凭文档 "must" 就定 error）
4. 运行 `npm test` 验证所有测试通过
5. 运行 `node skills/coreclaw-cli-audit/scripts/diff-contract.cjs` 确认 checklist 覆盖率与 API operationId 覆盖率
6. 更新 `references/contract-checklist.md` 标记为 `[x]` 并附实测括注
7. 更新 `references/known-gaps.md` 记录修复历史 + 探针结果
8. 提交并推送到 GitHub

## Severity 指南

| 严重性 | 含义 | 示例 |
|--------|------|------|
| `error` | 平台 upload/运行时硬拒或表单不渲染 | 缺失必填文件、缺失 output_schema.json、HTTP 脚本不读代理、硬编码代理凭证、Camoufox 未 pin playwright、upsert key 不在 output_schema、**未知 editor 值（如 text，表单不显示）** |
| `warn` | 平台接受但表单/运行可能异常或最佳实践 | editor-type 不匹配（实测平台不拒，但表单可能异常）、遗留类型别名、缺失 README、缺文档标必填的 title/editor/description/required |
| `info` | 仅提示 | 大小写不一致、batch 字段未配 split |

> 注：平台实测（2026-07-13）确认 editor/type 不匹配**不被拒绝**，已全部降为 warn。历史 "code 4000" 措辞已移除（该码不在 api/error-codes.md）。

## 运行审计脚本

```bash
node .coreclaw/skills/coreclaw-cli-audit/scripts/diff-contract.cjs
```

自动扫描 `schema.js` 和 `project.js` 中的校验调用（含 `error()`/`warn()` 助手与 `{severity:'error'}` 字面量两种形式），与 `contract-checklist.md` 交叉比对，输出：
- validation 调用统计（error/warn/info 计数 + 去重 issue code 数）
- checklist 覆盖率与 severity 分布
- checklist=error 但 code=warn 的降级候选
- `src/cloud/client.js` 方法 vs `exported-api-docs/openapi.json` 的 operationId 覆盖率（API contract gap）

## 文件结构

```
skills/coreclaw-cli-audit/
├── SKILL.md                    # 本文件
├── references/
│   ├── contract-checklist.md   # 从文档提取的可校验规则清单（版本化）
│   ├── known-gaps.md           # 已知缺口和历史修复记录
│   └── concurrency-rules.md   # 并发拆分规则摘录（2026-07 HTML）
└── scripts/
    └── diff-contract.cjs       # 自动比对脚本（validation + API contract）
```

## 审计历史

参见 `references/contract-checklist.md` 的「Audit History」章节。
