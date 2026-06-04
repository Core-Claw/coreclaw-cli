# CoreClaw CLI 路线图

本文档记录 CoreClaw CLI 的实际开发目标。每当 CLI 新增用户可见能力、关闭已知缺口，或平台限制发生变化时，都应同步更新本文档。

## 产品目标

CoreClaw CLI 要帮助开发者更少猜测、更少踩坑地构建可上传的 CoreClaw Worker。开发者应能创建 Worker、校验平台要求的文件、通过 CoreClaw 兼容的本地 SDK runtime 运行 Worker、检查输出、正确打包，并将本地输出与 CoreClaw 平台输出对比。

CoreClaw CLI 也应逐步成为 CoreClaw API 的终端入口：账户信息、Worker 搜索/详情/运行、Task 运行、云端 run 历史、run 详情、日志、结果列表、导出 URL、rerun 和 abort 都应能从命令行完成。

CLI 必须持续对齐 `E:\worker\knowledge-files\docs\developer-guide` 中的 CoreClaw Worker 定义。

## 范围原则

- 优先遵循 CoreClaw 平台契约，而不是泛化的爬虫工具习惯。
- 把本地成功视为上传前兼容性门槛，而不是松散 demo runner。
- 明确区分本地能力与云端能力：本地检查证明集成契约，真实托管行为仍需平台验证。
- 只暴露当前公开 CoreClaw API 文档支持的云端命令；在 API 契约不存在前，不伪造上传、发布、审核或版本管理命令。
- 先降低首次使用成本，再为生产 Worker 提供更严格的门槛。
- 保持文档和命令帮助与真实 CLI 行为同步。

## 目标拆解

### 1. 第一个 Worker 路径

目标：让用户从空目录到可验证上传包的路径足够清晰。

已完成：

- `coreclaw init` 可创建 Python、Node.js、Go Worker 模板，并写入 SDK 文件。
- `coreclaw validate` 检查根文件、SDK 文件、依赖、`input_schema.json` 和 `output_schema.json`。
- `coreclaw run` 启动本地 SDK runtime 并执行 Worker。
- `coreclaw verify` 在干净的类上传 runtime 中运行 Worker，并创建 ZIP。
- README 和 README_CN 描述 Worker 结构和上传工作流。
- 顶层帮助按工作流分组，`coreclaw help <command>` 提供命令示例。
- `docs/commands.md` 由 CLI help 同源元数据生成。
- `coreclaw init` 会根据 `input_schema.json` 默认值写入 `input.example.json`，方便首次本地冒烟测试；不需要该本地文件时可用 `--no-input-example`。
- `coreclaw examples` 可列出内置示例 Worker 及各平台契约推荐的 `verify` 命令。

可在本仓库解决的缺口：

- 增加更友好的 `create` 别名或向导式流程，帮助不知道选哪种语言的用户。
- 当示例 Worker 可以升级为生成模板后，增加 `coreclaw init --template <name>`。

当前不属于本地可解决范围：

- 直接在 CoreClaw 平台创建或发布 Worker 需要认证平台 API，不应在本地伪造。

### 2. 平台契约校验

目标：在用户上传 Worker 前捕获上传期常见错误。

已完成：

- 校验 Python、Node.js、Go 源项目所需文件。
- 校验 Node.js CommonJS SDK 使用方式和 runtime 依赖声明。
- 校验 Python import 与 `requirements.txt` 的一致性。
- 校验 Go SDK 依赖和 `go.sum` checksum。
- 校验 input schema 根字段、editor/type 配对、默认值、选项、数值范围和 split key。
- 校验 output schema 字段名和支持类型。
- 当 HTTP Worker 未读取 `PROXY_AUTH` 和 `PROXY_DOMAIN` 时给出警告。
- 当浏览器 Worker 未读取 CoreClaw 浏览器端点变量时给出警告。
- `coreclaw validate --json-output` 输出适合 CI 使用的机器可读校验报告。

可在本仓库解决的缺口：

- 增加 docs contract test，从本地 knowledge docs 快照支持的 input editors 和 output field types。
- 为动态 import 和可选 Worker 插件目录增加更精确的依赖扫描。

当前不属于本地可解决范围：

- 平台依赖安装速度或平台镜像可用性必须通过真实 CoreClaw run 证明。

### 3. Runtime 预检

目标：让本地 run 暴露开发者在 CoreClaw 中依赖的同类 SDK-facing 行为。

已完成：

- 本地 gRPC runtime 实现 parameter、log、table header 和 result API。
- 本地 run 写入 `.coreclaw/runs/<run-id>` 产物。
- runtime 在启动 Worker 前校验实际输入。
- runtime 根据 `output_schema.json` 投影结果并记录 drift。
- runtime 可强制最小结果数、状态成功、table header 和 output schema 匹配。
- 每次 run 使用隔离的本地临时状态。
- Node.js 绝对 `/tmp` 写入会映射到 run 临时目录。
- `coreclaw run --json-output`、`coreclaw verify --json-output`、`coreclaw inspect-run --json-output` 输出机器可读摘要，同时将进度日志写到 stderr。
- `coreclaw inspect-run` 对缺少结果、缺少 table header、schema drift、export drift 和失败状态行给出修复提示。

可在本仓库解决的缺口：

- 为 CI 集成稳定一份机器可读 summary schema。

当前不属于本地可解决范围：

- 精确的平台调度、重试和分布式任务并发行为无法脱离平台 API 完整复现。

### 4. 浏览器、代理、Lightpanda 和 CAPTCHA 契约

目标：在上传前证明 Worker 代码正确使用 CoreClaw runtime 集成点。

已完成：

- `--local-proxy` 启动带认证的本地 SOCKS5 代理。
- `--require-proxy-usage` 在 HTTP Worker 绕过代理时失败。
- 本地 Chrome discovery 会注入浏览器端点变量。
- `--require-browser` 在运行前检查 CDP 或 Selenium 风格端点。
- `--browser-cdp-shim` 校验 host-style `ChromeWs` 和 DrissionPage 风格路径。
- `--lightpanda-shim` 校验 `LightpandaDomain` 规范化和 Basic auth。
- `--captcha-solver` 校验 `Captchas.automaticSolver` 命令形状和参数。
- `coreclaw env` 不执行 Worker，只打印 runtime 环境变量和规范化端点形状。
- `examples/node-http-proxy` 提供可运行 Node.js HTTP 代理契约 Worker，通过 SOCKS5 CONNECT 使用 `PROXY_AUTH` 和 `PROXY_DOMAIN`。
- `examples/node-lightpanda-cdp` 提供可运行 Node.js Lightpanda CDP 契约 Worker，使用 `LightpandaDomain` 并从 `PROXY_AUTH` 构造 Basic auth。

可在本仓库解决的缺口：

- 在 run 摘要中更明显展示观察到的代理连接、CDP 连接和 CAPTCHA 调用。
- 增加浏览器 CDP 和 CAPTCHA 契约示例 Worker。

当前不属于本地可解决范围：

- 真实 fingerprint browser 行为、Lightpanda 渲染、代理地理位置和 CAPTCHA 成功率需要 CoreClaw 托管基础设施。

### 5. 打包与上传产物

目标：避免 ZIP 布局和 Go 二进制问题导致 Worker 还没产生日志就失败。

已完成：

- `coreclaw pack` 创建入口文件位于根目录的上传 ZIP。
- Go 包会构建为 Linux amd64 的 `main` 二进制。
- Go 根可执行文件模式会保留并检查为 `100755`。
- `inspect-package` 可发现多包一层目录和缺少根入口文件的问题。
- 打包会排除 `.coreclaw`、`node_modules`、virtualenv、cache、build output 等本地专用产物。
- `coreclaw pack --print-files` 可在创建 ZIP 前预览上传包内容。
- `inspect-package`、`pack` 和 `verify` 会对超过可配置本地建议阈值的 ZIP 发出警告。
- `inspect-package` 展示压缩/未压缩最大的 ZIP 条目，便于裁剪超大包。
- `inspect-package --project` 可对比既有 ZIP 与源项目预期上传清单。
- `coreclaw release dossier` 可整理发布候选 Worker 的本地校验、上传 ZIP、云端 run、对比、诊断、成本和 Console 手工发布步骤，形成 JSON/Markdown 交付报告；也可通过 `--run-evidence run-evidence.json` 直接消费 `coreclaw runs collect` 生成的证据包。

可在本仓库解决的缺口：

- 为语言特定边缘情况增加更多打包修复提示。
- 进一步文档化 release dossier 在团队交接中的推荐文件夹结构、命名约定和审核清单。

当前不属于本地可解决范围：

- 平台侧 ZIP 接收和内部解压行为仍需真实上传测试证明。

### 6. 云端 API 控制面与一致性对比

目标：让 CoreClaw 平台 run 可以从终端查看、保存并对比。

已完成：

- `coreclaw account info` 调用已文档化账户 API，并报告余额、流量使用和流量过期时间。
- `coreclaw workers search` 使用公开 Store search API。
- `coreclaw workers detail` 使用公开 Worker detail API，并打印最新版本和 system/custom 参数形状。
- `coreclaw workers run` 通过 `/api/v1/scraper/run` 启动 Worker，支持 `--version auto`、异步模式、同步模式、callback URL 和 JSON 输入文件。
- `coreclaw workers run --wait` 可轮询云端 run 到终态，通过 `--results-output cloud-results.json` 保存 result-list wrapper，便于继续交给 `coreclaw compare`；也可通过 `--run-evidence-output run-evidence.json` 直接生成 run evidence bundle。
- `coreclaw tasks run` 通过 `/api/v1/task/run` 启动已保存 Task，并强制文档要求的 callback URL；可选 `--wait`、`--results-output` 和 `--run-evidence-output` 能等待 Task run 结束、保存结果并生成 run evidence bundle。
- `coreclaw runs list`、`detail`、`logs`、`results`、`export`、`diagnose`、`cost`、`rerun`、`abort` 覆盖已文档化 Run API 和组合诊断流程。
- `coreclaw runs results --output cloud-results.json` 写入 result-list wrapper，可被 `coreclaw compare` 直接读取。
- `coreclaw runs export --download-output export.json|export.csv` 会从返回的 `download_url` 下载文件，且不会把 CoreClaw API key 转发给签名 URL。
- `coreclaw runs diagnose` 会组合 run detail、最近日志和结果列表，输出状态、错误、日志摘要、可选 API 缺失情况和下一步命令，并可写出 JSON 诊断报告。
- `coreclaw runs cost` 基于 Run Detail 中已文档化的 `usage`、`traffic`、duration 和 results 输出单次 run 的基础用量/成本报告，并明确细分成本尚需平台 API。
- `coreclaw runs collect` 可一次收集 run detail、最近日志、结果样本、导出 URL、可选导出文件、诊断和成本线索，写成 JSON/Markdown 证据包，减少发布前手动跑多条 `runs` 子命令。
- `coreclaw prove` 将本地上传预检、云端 Worker run、云端 run 轮询、结果列表下载、本地/云端对比组合起来，用于已上传 Worker 的闭环证明；可选 `--run-evidence-output` 和 `--release-output` 能在对比通过后继续写出 run evidence bundle 和发布候选 dossier。
- `compare` 可读取 CoreClaw JSON 数组、result-list wrapper 和 CSV export。
- `compare --json-summary` 会在 stdout 输出版本化精简 JSON 摘要，保留完整 `--output` 报告，便于 CI、dashboard 和自动化脚本消费。
- `verify --cloud-output` 可将云端对比纳入上传预检。
- compare profile 支持可复用 key、忽略字段、忽略行、状态门槛和 schema 门槛。
- `audit` 可为多个 Worker 目录写出 JSON 和 Markdown 报告。

可在本仓库解决的缺口：

- 记录并演进 `compare --json-summary` 的版本化字段契约，便于 dashboard 长期兼容。
- 为常见 Worker 结果形状增加 profile 生成器。
- 增加一页短文档，说明推荐的云端结果命令和文件命名。

当前不属于本地可解决范围：

- Worker 上传、Worker 版本管理、Store 提交、审核流程和发布仍需要当前文档以外的平台公开 API 契约。
- 平台侧 API 和产品缺口单独记录在 [docs/platform-backlog.md](./platform-backlog.md)。

## 当前已知缺口

### 可在本仓库解决

- 为每个子命令增加更丰富的 flag 说明。
- 稳定并版本化 CI 友好的 JSON 输出 schema。
- 增加更多 Worker 模板和示例输入。
- 在 `migrate apify` 审计基础上增加可选转换器或模板生成器，减少手动迁移输入 schema、输出和 SDK 生命周期的工作量。
- 为常见 validation/runtime 失败增加更好的修复提示。
- 当 CLI 行为足够稳定后增加版本化文档。

### 不能完全在本地解决

- 真实托管浏览器渲染和 fingerprint 行为。
- 真实 Lightpanda 导航性能和兼容性。
- 真实 CAPTCHA 绕过效果。
- 真实代理出口区域和目标站信誉。
- 平台调度器行为、审核流程、商业化和公开 Worker Store 发布。
- Worker 上传、版本管理和发布，直到稳定公开 API 契约可供 CLI 使用。

## 最近完成

- 重写英文和中文 README，使其成为用户/开发者指南。
- 移除旧 implementation-plan 和 legacy compare wrapper 文件。
- 增加结果状态、table header、output schema、browser shim、Lightpanda、CAPTCHA、proxy usage 和 Go package shape 的严格上传预检门槛。
- 增加 ZIP 根入口和 Go executable mode 的 package inspection。
- 增加平台输出验证辅助脚本，供本地维护者使用。
- 增加分组顶层帮助、`coreclaw help <command>`、`<command> --help` 和相近命令建议。
- 增加由 CLI 命令元数据生成的中文命令参考文档。
- 增加 `coreclaw pack --print-files`，用于预览上传包内容。
- `coreclaw init` 默认生成 `input.example.json`，并在上传打包时排除该本地辅助文件。
- 为 `validate`、`run`、`verify`、`inspect-run` 增加 `--json-output`。
- 增加可配置 package size 警告：`--max-package-size`。
- 增加上传包最大条目诊断。
- 为既有 ZIP 增加 `inspect-package --project` 上传清单对比。
- 增加 `coreclaw env`，用于运行前检查注入的 runtime 环境变量。
- 为常见 run artifact 失败增加 `inspect-run` 修复提示。
- 增加无依赖 Node.js HTTP proxy contract 示例，并可通过本地 SOCKS5 proxy 校验。
- 增加轻依赖 Node.js Lightpanda CDP contract 示例，并可通过本地 CDP shim 校验。
- 增加 `coreclaw examples`，让内置契约示例可从 CLI 发现。
- 增加已文档化 CoreClaw 云端命令组：`account`、`workers`、`tasks`、`runs`。
- 增加 CoreClaw API client，处理 `CORECLAW_API_KEY`、公开端点、认证端点、API 业务错误码和无效 JSON 响应，且不泄露 API key。
- 增加 `coreclaw doctor --cloud`，默认检查 CoreClaw 账号连通性，可选检查公开 Worker detail；只有显式传入 `--cloud-input` 时才启动真实云端冒烟 run，并可等待、保存结果和生成证据包。
- 增加 `coreclaw runs results --output`，让云端 result-list 响应可保存并直接与本地 run artifact 对比。
- 增加 `coreclaw runs export --download-output`，让 export URL 直接变成本地 JSON/CSV 文件。
- 增加 `coreclaw prove`，用于已上传 Worker 的闭环：本地预检 -> 云端 run -> 轮询 -> 保存云端结果 -> 对比，并可选生成 run evidence bundle 与 release dossier。
- 增强 `coreclaw workers run --wait`，让单独启动的云端 run 也能等待完成、失败时提示 `runs logs`，并可保存结果文件或直接生成 run evidence bundle。
- 增加 `coreclaw runs diagnose`，把已文档化 Run API 组合成云端失败排查报告。
- 增加 `coreclaw runs cost`，用已文档化 Run Detail 字段输出 run 用量/成本线索。
- 增加 `coreclaw runs collect`，把 run 详情、日志、结果、导出、诊断和成本线索打成 JSON/Markdown 证据包，可直接交给 release dossier 或团队复盘使用。
- 增强 `coreclaw tasks run`，让已保存 Task 模板启动后也能等待云端 run、保存结果并生成 run evidence bundle。
- 增加 `coreclaw compare --json-summary`，输出版本化精简对比摘要，便于 CI 和 dashboard 读取。
- 增加 `coreclaw migrate apify`，可静态审计 Apify/Crawlee Actor 的 schema、Dataset、KeyValueStore、RequestQueue、proxy、browser 和 SDK 生命周期迁移工作量，并写出 JSON/Markdown 报告。
- 增加 `coreclaw release dossier`，在平台公开上传/发布 API 前，把本地包、云端测试、结果对比、诊断、成本和 Console 发布步骤整理成发布候选交付报告，并支持直接引用 `coreclaw runs collect` 的 run evidence bundle。
- 增加 `docs/platform-backlog.md`，将平台 API/产品缺口与 CLI 本地实现工作分开记录。

## 下一批里程碑

1. 增加更丰富的浏览器 CDP 和 CAPTCHA Worker 示例。
2. 在 Apify 迁移审计报告基础上增加转换模板或代码片段建议。
3. 文档化 `compare --json-summary` schema，并补充常见 CI 示例。
