# CoreClaw 平台待补能力记录

本文档记录平台侧需要补足的 API、产品能力和框架生态能力，以便 CoreClaw CLI 最终成为更完整的平台终端入口。

本文档与 `docs/roadmap.md` 分工不同：`roadmap.md` 记录本仓库当前可实现的 CLI 工作；本文档记录 CLI 想要消费、但需要平台先公开或增强的契约。

## 目标

CoreClaw CLI 最终应支持完整 Worker 交付闭环：

```text
本地预检 -> 上传/导入 -> 云端测试 -> 结果对比 -> 发布
```

CLI 当前已经可以完成本地校验、运行、打包、包检查、调用已文档化 run API、下载结果和对比输出。剩余缺口主要集中在平台侧：Worker 所属关系、上传、版本管理、发布审核和更丰富的云端诊断。

## 需要平台补足的 API 契约

### Worker 上传与导入

需要的平台能力：

- 通过 ZIP 创建 Worker。
- 为已有 Worker 上传新 ZIP 包。
- 通过 GitHub URL 导入 Worker。
- 从 branch、tag 或 commit 重新导入。
- 返回上传/build 状态、日志和结构化错误码。
- 返回标准 `scraper_slug`、version、build/import id 和 Console URL。

可启用的 CLI 命令：

- `coreclaw workers push`
- `coreclaw workers import`
- `coreclaw workers upload`
- `coreclaw prove --push`

### Worker 版本管理

需要的平台能力：

- 列出 Worker 版本。
- 从上传 ZIP 或 GitHub ref 创建版本。
- 设置 active/default version。
- 回滚到旧版本。
- 删除或归档版本。
- 读取版本 build 日志和依赖安装诊断。

可启用的 CLI 命令：

- `coreclaw workers versions list <scraper_slug>`
- `coreclaw workers versions create <scraper_slug>`
- `coreclaw workers versions activate <scraper_slug> <version>`
- `coreclaw workers versions rollback <scraper_slug> <version>`

### 发布、审核与 Store 元数据

需要的平台能力：

- 提交 Worker 到 Store 审核。
- 读取审核状态和审核意见。
- 发布/下架 Worker。
- 更新 Store 元数据：标题、描述、分类、README、图标、价格、示例输入。
- 在提交前校验元数据。

可启用的 CLI 命令：

- `coreclaw workers submit`
- `coreclaw workers publish`
- `coreclaw workers review-status`
- `coreclaw workers metadata validate`

### Task 与计划任务

需要的平台能力：

- 列出已保存 Task。
- 创建、更新、删除 Task 模板。
- 读取 Task 输入和 system 参数。
- 如果平台支持 scheduled run，公开计划任务管理 API。

可启用的 CLI 命令：

- `coreclaw tasks list`
- `coreclaw tasks detail <task_slug>`
- `coreclaw tasks create`
- `coreclaw tasks update`
- `coreclaw tasks delete`

当前 CLI 临时能力：

- 已公开的 `POST /api/v1/task/run` 已接入 `coreclaw tasks run`；CLI 可在启动 Task 后等待 run 结束、保存结果，并通过 `--run-evidence-output` 生成证据包。
- Task 模板的列出、读取、创建、更新、删除和计划任务能力仍需要平台公开 API 后才能成为 CLI 一等命令。

### 成本、额度与用量

当前账户余额、流量额度和 run detail 中的聚合 `usage` / `traffic` 已有文档化接口。CLI 已经可以通过 `coreclaw account info` 查看账户层信息，并通过 `coreclaw runs cost <run_slug>` 查看单次 run 的基础用量/成本线索。后续还需要：

- Worker/run 级别成本拆分：CPU、memory、traffic、proxy region、browser、CAPTCHA、平台费用。
- run 启动前的成本预估 endpoint。
- quota warning threshold。

可启用的 CLI 命令：

- `coreclaw account usage`
- `coreclaw runs cost <run_slug>` 的增强版：展示 CPU、memory、proxy、browser、CAPTCHA 和平台费用拆分。
- `coreclaw workers estimate <scraper_slug> --input request.json`

### 诊断与健康检查

CLI 当前已经可以通过 `coreclaw runs diagnose <run_slug>` 组合 run detail、最近日志和结果列表，生成基础排查报告。后续仍需要平台提供更深的结构化诊断能力：

需要的平台能力：

- 结构化 run 失败原因。
- 依赖安装日志。
- runtime image / language version 元数据。
- 浏览器池连接诊断。
- 代理 region 和出口 IP 诊断。
- CAPTCHA solver 状态和用量记录。

可启用的 CLI 命令：

- `coreclaw runs diagnose <run_slug>` 的增强版：直接读取平台结构化诊断字段、资源用量和基础设施错误分类。
- `coreclaw workers health <scraper_slug>`
- `coreclaw doctor --cloud`

## 改善 CLI 体验的平台产品能力

### 稳定的机器可读 schema

CLI 消费的每个 API response 都应有版本化 schema 或明确稳定字段。优先字段：

- Worker detail：`scraper_slug`、`version`、`parameters.system`、`parameters.custom.properties`。
- Run detail：`run_slug`、`scraper_slug`、`version`、`status`、`status_label`、`err_msg`、`usage`、`traffic`、timestamps。
- Run results：`headers`、`list`、`count`、`page_index`、`page_size`。
- Export：`download_url`、过期时间、format、selected fields。
- Upload/build：status、logs URL、dependency install result、platform validation issues。

### Console 深链

API response 建议返回这些 Console URL：

- Worker detail。
- Worker version/build/import。
- Run detail。
- Result table。
- Review submission。

CLI 可在每次云端操作后打印这些链接，降低用户跳转成本。

### 安全测试 run 契约

平台应支持低风险、低成本的 CLI smoke test 模式：

- 明确 dry-run 或 test-run 标记。
- 小型固定资源限制。
- 清晰的计费行为。
- 可选自动清理。

这样 `CORECLAW_API_KEY` 门控测试可以验证真实云端行为，而不依赖生产 Worker。

当前 CLI 临时能力：
- `coreclaw doctor --cloud` 可以先验证账号 API、公开 Worker detail，并在显式传入 `--cloud-input` 时启动真实 Worker run；这仍依赖用户选择低风险 Worker 和输入，不能替代平台侧专门的 dry-run/test-run 契约。

## 框架与模板机会

### Apify 迁移支持

平台文档和 CLI 模板应覆盖：

- Apify Actor input schema 到 CoreClaw `input_schema.json`。
- Apify dataset rows 到 CoreClaw SDK `push_data`。
- Apify key-value stores 和 request queues，包括不支持或需要手动迁移的场景。
- Crawlee HTTP/browser 模式适配 CoreClaw proxy 和 browser endpoint 契约。

当前 CLI 临时能力：

- `coreclaw migrate apify [project]` 可静态识别 Apify/Crawlee 项目特征，并输出 JSON/Markdown 迁移审计报告。
- 报告已覆盖 input schema、Dataset 输出、KeyValueStore、RequestQueue、proxy configuration、browser crawler 和 CoreClaw SDK 生命周期适配。

仍需补足：

- 从 Apify input schema 到 CoreClaw `input_schema.json` 的安全转换器。
- 常见 Crawlee HTTP/browser Actor 的迁移模板或代码片段。
- 平台文档中的 Apify 迁移专页。

### Worker 模板目录

建议优先建设这些模板族：

- 基础 Python Worker。
- 基础 Node.js Worker。
- 基础 Go Worker。
- 使用 `PROXY_AUTH` 和 `PROXY_DOMAIN` 的 HTTP request Worker。
- 使用 `ChromeWs` 或 `CDP_ENDPOINT` 的 Playwright Worker。
- 使用 `ChromeWs` 的 Puppeteer Worker。
- 使用 `LightpandaDomain` 和 Basic auth 的 Lightpanda CDP Worker。
- 使用 `Captchas.automaticSolver` 的 CAPTCHA Worker。

### SDK 与 runtime 对齐

CLI 本地模拟器应持续对齐：

- SDK 方法名和 wire format。
- runtime 环境变量名。
- output schema 与 runtime table header 行为。
- run status codes。
- browser、Lightpanda、proxy、CAPTCHA 契约。

任何平台侧 SDK 改动都应有更新说明，便于 CLI 转化为 contract test。

## 当前 CLI 临时绕行方案

在平台公开缺失 API 之前：

- `coreclaw pack` 可创建上传就绪 ZIP，但用户仍需通过 Console 上传或导入。
- `coreclaw workers run --wait --run-evidence-output run-evidence.json` 可在已上传 Worker 上完成云端测试并生成证据包，适合尚未接入自动上传/发布 API 前的手工上传后验证。
- `coreclaw release dossier` 可把本地校验、上传 ZIP、云端 run、结果对比、诊断、成本和 Console 手工步骤整理为发布候选交付报告，并可通过 `--run-evidence` 直接消费 `coreclaw runs collect` 的证据包。
- `coreclaw prove` 可对已上传 Worker 启动云端 run 并做本地/云端结果对比；当传入 `--run-evidence-output` 和 `--release-output` 时，可在当前公开 API 范围内继续生成发布候选证据包。
- `coreclaw runs collect` 可在已有 run 存在时一次收集 detail、最近日志、结果样本、导出 URL/文件、诊断和成本线索，形成 JSON/Markdown 证据包；它仍然依赖当前公开 Run API，不能替代平台侧结构化诊断和成本拆分 API。
- `coreclaw runs results --output` 和 `coreclaw runs export --download-output` 可把结果文件保存到本地并用于脚本化流程。
- `coreclaw compare` 可在平台 run 已存在后验证云端/本地一致性，`--json-summary` 可为 CI 和 dashboard 输出精简机器摘要。

## 更新节奏

遇到以下情况时更新本文档：

- 新 CoreClaw public API 已文档化。
- 平台限制阻塞 CLI 交付闭环功能。
- 平台已提供直接 API，某个 CLI workaround 不再需要。
- 新框架或 Worker 模式应升级为一等模板。
