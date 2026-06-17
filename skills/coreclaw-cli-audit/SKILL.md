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

## 审计流程

### Phase 1: 规则提取

对每个文档页面，提取可机器校验的规则：

- "must" / "required" / "shall" → 校验规则
- "type must be" / "editor" → 类型约束
- "error" / "reject" / "400" / "Invalid" → 平台拒绝条件
- JSON 示例中的结构 → schema shape 约束
- 表格中的字段定义 → 必填/可选/类型/枚举

### Phase 2: 代码比对

对每条提取的规则，检查：
1. `src/validation/schema.js` 是否有对应的校验函数
2. 校验的 severity 是否正确（平台拒绝 = `error`，不只是 `warn`）
3. 错误消息是否包含修复建议（建议提及 code 4000）
4. `test/schema.test.js` 是否有对应的测试用例

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
| `error` | 平台会拒绝（code 4000） | editor-type 不匹配、类型错误、缺失必填字段 |
| `warn` | 最佳实践但平台可能接受 | 未知 editor、遗留类型别名、缺失 README |
| `info` | 仅提示 | 大小写不一致 |

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