# CoreClaw CLI

本地开发、校验、打包 [CoreClaw Worker](https://coreclaw.com) 的命令行工具。

English: [README.md](#overview) | 中文: [README_CN.md](./README_CN.md)

## 概述

CoreClaw CLI 帮助开发者在上传前本地检查 Worker 项目：校验文件结构、schema 契约、SDK 依赖、运行时行为，并生成可上传的 ZIP 包。

**核心能力：**

- 校验 `input_schema.json` / `output_schema.json` 与平台契约的一致性
- 校验项目结构（必填文件、SDK 文件、package.json / requirements.txt / go.mod）
- 本地运行 Worker 并捕获日志、表格头、推送行
- 比较云端运行结果与本地输出
- 生成可上传的 ZIP 包（Node.js / Python / Go）
- 审计 Apify/Crawlee Actor 迁移工作量

## 安装

```bash
git clone https://github.com/Core-Claw/coreclaw-cli.git
cd coreclaw-cli
npm install
node ./bin/coreclaw.js --help
```

## 快速开始

```bash
# 创建 Worker 项目
node ./bin/coreclaw.js init ./my-worker --language node --name my-worker

# 校验
node ./bin/coreclaw.js validate ./my-worker --strict

# 本地运行
node ./bin/coreclaw.js run ./my-worker --input ./input.json --min-results 1

# 打包上传
node ./bin/coreclaw.js pack ./my-worker --output ./my-worker.zip
```

## 校验体系

CLI 提供多层校验，确保 Worker 在平台上不会被拒绝：

### Schema 校验

- `input_schema.json`：字段类型、editor 兼容性、默认值类型、required 字段、selector options
- `output_schema.json`：列名唯一性、type 必填、支持的类型枚举

### 项目结构校验

- 必填文件检查（按语言：Node.js / Python / Go）
- SDK 依赖声明检查（`@grpc/grpc-js`、`google-protobuf`、`grpcio` 等）
- package.json 入口和类型检查（`main: main.js`、`type: commonjs`）

### 平台特性校验

- 代理：检测 HTTP 客户端是否读取 `PROXY_AUTH` / `PROXY_DOMAIN`
- 浏览器：检测是否使用 `ChromeWs` / `LightpandaDomain` 端点
- CAPTCHA：检测 CDP 命令契约

### 上传预检

```bash
node ./bin/coreclaw.js verify ./worker --strict \
  --input input.json \
  --min-results 1 \
  --require-table-header \
  --require-output-schema-match
```

## 审计 Skill

仓库包含自动化审计技能，用于持续检查 CLI 校验逻辑与官方文档的一致性：

```
skills/coreclaw-cli-audit/
├── SKILL.md                    # 审计流程
├── references/
│   ├── contract-checklist.md   # 55 条规则清单（100% 覆盖）
│   └── known-gaps.md           # 历史修复记录
└── scripts/
    └── diff-contract.cjs       # 自动覆盖率扫描
```

运行覆盖率扫描：

```bash
node skills/coreclaw-cli-audit/scripts/diff-contract.cjs
```

## 开发 Skill

`skills/coreclaw-cli/SKILL.md` 是 AI agent 开发指南，包含：

- Worker 契约规范（文件结构、schema 规则、SDK 模块）
- 命令开发工作流
- 测试和验证命令
- 发布检查清单

## 命令参考

### Worker 开发

| 命令 | 说明 |
|------|------|
| `init` | 创建包含 SDK 文件和 schema 的 Worker 项目 |
| `validate` | 校验项目结构、依赖、schema |
| `run` | 本地运行 Worker |
| `verify` | 上传预检（staging 级别校验） |
| `env` | 打印运行时环境变量 |

### 打包与检查

| 命令 | 说明 |
|------|------|
| `pack` | 生成可上传 ZIP 包 |
| `inspect-package` | 检查 ZIP 包内容 |

### 云端操作

| 命令 | 说明 |
|------|------|
| `account` | 账户信息 |
| `workers` | 搜索/查看 Worker |
| `runs` | 运行历史/详情/结果/导出 |
| `tasks` | 任务管理 |

### 对比与诊断

| 命令 | 说明 |
|------|------|
| `compare` | 云端结果与本地输出对比 |
| `doctor` | 诊断环境问题 |
| `audit` | 批量校验多个 Worker |

## 完整命令参考

详见 [docs/commands.md](./docs/commands.md)，包含每条命令的详细用法、选项和示例。

## 平台契约参考

CLI 的校验规则基于官方文档：

- [项目结构](https://docs.coreclaw.com/developer-guide/worker-definition/project-structure/)
- [输入 Schema](https://docs.coreclaw.com/developer-guide/worker-definition/input-schema/)
- [输出 Schema](https://docs.coreclaw.com/developer-guide/worker-definition/output-schema/)
- [SDK 模块](https://docs.coreclaw.com/developer-guide/worker-definition/sdk-modules/)
- [代理支持](https://docs.coreclaw.com/developer-guide/worker-definition/platform-features/proxy-support/)
- [浏览器指纹](https://docs.coreclaw.com/developer-guide/worker-definition/platform-features/browser-fingerprinting/)
- [CAPTCHA 处理](https://docs.coreclaw.com/developer-guide/worker-definition/platform-features/captcha-handling/)
- [API 集成](https://docs.coreclaw.com/api/integration/)

## 开发

```bash
# 运行测试
npm test

# 生成命令文档
npm run docs

# 发布检查
npm run verify:release
```

## CI

GitHub Actions 在 Windows + Node 20.x/22.x 上运行测试。Linux CI 已移除（大小写敏感测试依赖 Windows 文件系统行为）。

## License

MIT