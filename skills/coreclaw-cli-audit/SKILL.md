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

### Phase 2: 代码比对

对每条提取的规则，检查：
1. `src/validation/schema.js` 是否有对应的校验函数
2. `src/runtime/input.js` 是否正确模拟本地 `--split` 运行时行为
3. 校验的 severity 是否正确（平台拒绝 = `error`，平台接受但表单/运行可能异常 = `warn`）
4. 错误消息是否包含修复建议（不要写 "code 4000"——平台实测不拒绝 editor/type 不匹配，且该码不在 error-codes.md）
5. `test/schema.test.js` 是否有对应的测试用例

特别注意：`b` 已不是必填字段。新规则优先 `concurrency.fields`，没有有效新规则时才回退旧版 `b`。审计时不要把缺少 `b` 当作错误。

### Phase 3: 缺口报告

输出格式：
- `[ERROR]` 规则 X 在文档中定义但 CLI 未校验
- `[WARN]`  规则 Y 的 severity 应为 error 但当前是 warn
- `[OK]`    规则 Z 已正确实现并有测试覆盖

### Phase 4: 修复

对每个 ERROR/WARN：
1. 在 `schema.js` 或 `project.js` 中实现修复
2. 在 `schema.test.js` 或 `project.test.js` 中补充测试
3. 运行 `npm test` 验证所有测试通过
4. 更新 `references/contract-checklist.md` 标记为 `[x]`
5. 更新 `references/known-gaps.md` 记录修复历史
6. 提交并推送到 GitHub

## Severity 指南

| 严重性 | 含义 | 示例 |
|--------|------|------|
| `error` | 平台 upload/运行时硬拒 | 缺失必填文件、缺失 output_schema.json、HTTP 脚本不读代理、硬编码代理凭证、Camoufox 未 pin playwright、upsert key 不在 output_schema |
| `warn` | 平台接受但表单/运行可能异常或最佳实践 | editor-type 不匹配（实测平台不拒，但表单可能异常）、未知 editor、遗留类型别名、缺失 README、缺文档标必填的 title/editor/description/required |
| `info` | 仅提示 | 大小写不一致、batch 字段未配 split |

> 注：平台实测（2026-07-13）确认 editor/type 不匹配**不被拒绝**，已全部降为 warn。历史 "code 4000" 措辞已移除（该码不在 api/error-codes.md）。

## 运行审计脚本

```bash
node .coreclaw/skills/coreclaw-cli-audit/scripts/diff-contract.cjs
```

自动扫描 `schema.js` 和 `project.js` 中的校验调用，与 `contract-checklist.md` 交叉比对，输出覆盖率。

## 文件结构

```
.coreclaw/skills/coreclaw-cli-audit/
├── SKILL.md                    # 本文件
├── references/
│   ├── contract-checklist.md   # 从文档提取的可校验规则清单（版本化）
│   └── known-gaps.md           # 已知缺口和历史修复记录
└── scripts/
    └── diff-contract.cjs        # 自动比对脚本
```

## 审计历史

参见 `references/contract-checklist.md` 的「Audit History」章节。
