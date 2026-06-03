# CoreClaw CLI

CoreClaw worker 本地运行时、验证器和上传前预检 CLI。

CoreClaw 官方开发者文档描述了上传就绪的 worker 项目结构、平台注入的 SDK 文件、`input_schema.json`、`output_schema.json`、SDK gRPC 端点 `127.0.0.1:20086`，以及 `PROXY_AUTH`、`PROXY_DOMAIN`、`ChromeWs` 等运行时变量。同时，官方文档也说明本地 SDK worker 模式尚不可用。本 CLI 的目标就是补齐这个缺口，让开发者在上传前尽量做到“本地跑通 = 平台跑通”。

## 模拟能力

- CoreClaw SDK gRPC 服务：
  - `Parameter/GetInputJSONString`
  - `Result/SetTableHeader`
  - `Result/PushData`
  - `Log/Debug`、`Log/Info`、`Log/Warn`、`Log/Error`
- 从 `input_schema.json` 默认值、`--input` 或 `--json` 注入运行输入。
- worker 启动前校验实际输入是否满足 `input_schema.json` 的 required 字段、声明类型、数值边界、选择器选项和列表编辑器项结构。
- 平台环境变量：
  - `ChromeWs`
  - `LightpandaDomain`
  - `CDP_ENDPOINT` / `BROWSER_WS_ENDPOINT`
  - 请求云端代理模式时的 `PROXY_AUTH` / `PROXY_DOMAIN`
- 每次运行独立的临时状态目录：
  - `CORECLAW_TMP_DIR`
  - `TMPDIR` / `TMP` / `TEMP`
- `.coreclaw/runs/<run-id>/` 下的运行生命周期产物。
- `output_schema.json` 输出表投影，以及结果/schema 漂移记录。
- 可选严格校验 worker 是否调用了 runtime `set_table_header`。
- 可选校验结果行里的业务失败状态。
- 上传 ZIP 结构验证和打包。
- `verify` 默认从上传包视角的临时 staging 目录运行，并在该目录安装依赖。
- Go 上传打包：
  - 干净的上传 staging。
  - `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o main ./main.go`。
  - ZIP 根目录包含可执行文件 `main`。

它不会模拟 CoreClaw 真实的远程指纹浏览器池。浏览器 worker 可以启动本地 Chrome remote debugging `127.0.0.1:9222`，或用 `--chrome-ws` / `--chrome-http` 传入真实远程 CDP/WebDriver 端点，再配合 `--require-browser` 在端点不可用时提前失败。HTTP worker 可以使用 `--local-proxy --require-proxy-usage` 通过 `PROXY_AUTH` / `PROXY_DOMAIN` 暴露本地 SOCKS5 代理，并在 worker 绕过代理时让 run 失败。

它也不会在本地模拟真实 Lightpanda 页面渲染。`--lightpanda-shim` 会通过 `LightpandaDomain` 暴露一个本地 CDP shim；`--require-lightpanda-shim` 会在 worker 没有连接 `/devtools/browser/new`，或没有按文档用 `PROXY_AUTH` 构造 Basic `Authorization` header 时让 smoke run 失败。这个门槛验证的是上传前 Lightpanda 端点契约；真实导航和渲染仍需在 CoreClaw 平台或真实上游 CDP endpoint 上验证。

它也不会在本地真正破解 CAPTCHA。`--captcha-solver` 会暴露一个本地 CDP shim，用来模拟 CoreClaw 文档里的自定义命令 `Captchas.automaticSolver`；`--require-captcha-solver` 会在 worker 没有调用该命令，或调用参数不符合官方 `timeout` / `solverType` 契约时让 smoke run 失败。这个门槛验证的是上传前集成契约，真实 CAPTCHA 绕过仍然只发生在 CoreClaw 托管的指纹浏览器中。

## 安装

在仓库内：

```bash
npm install
node ./bin/coreclaw.js --help
```

本地开发时也可以直接调用可执行文件：

```bash
node E:/worker/coreclaw-cli/bin/coreclaw.js doctor
```

提交 CLI 改动前运行：

```bash
npm run verify
```

这个命令会先跑单元测试，再对 Node 示例 worker 执行 `coreclaw verify`，包括与 `examples/node-hello-cloud-output.json` 的云端输出对比。测试套件还会对生成的 Node 和 Python 模板做端到端 smoke：`init` 创建 worker，`verify` 从上传视角 staging 执行，并启用结果行、table-header、output-schema 等严格门槛，最后确认生成的 ZIP 通过包检查。

## 命令

### 创建 Worker

```bash
node ./bin/coreclaw.js init ./my-worker --language node --name my-worker
node ./bin/coreclaw.js init ./my-python-worker --language python
node ./bin/coreclaw.js init ./my-go-worker --language go
```

生成的项目会包含 CoreClaw 官方文档要求的 SDK 文件：

- Python: `sdk.py`, `sdk_pb2.py`, `sdk_pb2_grpc.py`
- Node.js: `sdk.js`, `sdk_pb.js`, `sdk_grpc_pb.js`
- Go: `GoSdk/sdk.go`, `GoSdk/sdk.pb.go`, `GoSdk/sdk_grpc.pb.go`

### 静态校验

```bash
node ./bin/coreclaw.js validate ./examples/node-hello
```

校验内容包括：

- 根目录只能有一个入口文件：`main.py`、`main.js` 或 `main.go`。
- 必需的依赖文件、SDK 文件和 `input_schema.json`。
- 缺少 `README.md` 时给出上传就绪 worker 文档 warning。
- 按官方 `main.js` + CommonJS 契约检查 Node `package.json` 的 `main` / `type` 字段。
- SDK 运行时依赖必须声明在平台依赖文件中：
  - Python: `requirements.txt` 中的 `grpcio`、`protobuf`
  - Node.js: `package.json` 中的 `@grpc/grpc-js`、`google-protobuf`
  - Go: `go.mod` 中的 `google.golang.org/grpc`、`google.golang.org/protobuf`
- `input_schema.json` 根字段、唯一 property name、受支持的类型/editor、官方文档中的 editor/type 搭配、数值 `minimum` / `maximum` 边界、selector `options`、`requestListSource.param_list` 和 default 形态。
- `input_schema.b` 必须指向一个 array property。
- 存在 `output_schema.json` 时校验列名和受支持类型。

CoreClaw 上传后会从 `requirements.txt`、`package.json` 或 `go.mod` 安装依赖。因此 CLI 会拒绝那些本地机器因为已安装 SDK 包而能运行、但云端安装文件没有声明这些包的 worker。

运行时，CLI 还会校验由默认值、`--input` 或 `--json` 拼出的实际输入。如果某个字段标记了 `"required": true` 但本次输入缺失或为空，或者声明字段的 JSON 类型不匹配，或者数值字段超出 `minimum` / `maximum`，或者 `select`/`radio`/`checkbox` 的值不在 `options` 中，或者列表编辑器项结构不符合文档，命令会在创建 run 产物和启动 worker 前失败，贴近 CoreClaw 表单层的启动行为。

列表编辑器中，`requestList` 项必须包含非空 `url`，`stringList` 项必须包含非空 `string`，`requestListSource` 项可以使用 `param_list` 声明的自定义字段。静态校验会检查 `param_list` 结构、重复 param name、受支持的 param type/editor、数值边界、selector options 以及 editor/type 搭配；运行时再逐项校验 required 字段、JSON 类型、数值边界和 selector options。

官方文档把 `output_schema.json` 描述为上传就绪项目文件，但当前平台仍兼容没有 `output_schema.json` 的老 worker。因此 CLI 把缺失 `output_schema.json` 作为 warning，而不是阻塞错误。没有 output schema 时，本地 `export.ndjson` 会保留完整原始结果行。

当存在 `output_schema.json` 时，本地运行会按声明列生成 `export.ndjson`，并把 pushed result 与 schema 的漂移记录到 `output_schema_issues.json`。runtime `set_table_header` 的 key 或 format 与 `output_schema.json` 不一致时也会给出 warning。需要上传前严格门槛时，在 `run` 或 `verify` 中加入 `--require-output-schema-match`；如果结果行缺少声明字段、包含未声明字段、声明字段类型错误，或不是 JSON object，命令会失败。

CoreClaw SDK 文档把 `set_table_header` 描述为返回结果前的 runtime 表结构定义步骤。CLI 默认只在 worker 没有调用它时给出 warning，以兼容只依赖 `output_schema.json` 的历史 worker。需要把这个 SDK 契约变成上传前 hard gate 时，在 `run` 或 `verify` 中加入 `--require-table-header`。

### 批量审计 Worker

```bash
node ./bin/coreclaw.js audit E:/worker \
  --output ./tmp/all-workers-audit.json \
  --markdown ./tmp/all-workers-audit.md \
  --soft
```

`audit` 会发现根目录下的 `worker-*` 项目，执行与 `validate` 相同的项目/schema 校验，并写出 JSON/Markdown 报告。只有当你明确想校验任何包含 `main.py`、`main.js` 或 `main.go` 的目录时，才使用 `--all`。

### 本地运行

```bash
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello --json "{\"url\":\"https://example.com\"}"
node ./bin/coreclaw.js run ./examples/node-hello --input input.json
node ./bin/coreclaw.js run ./examples/node-hello --timeout-ms 10m --idle-timeout-ms 30s
node ./bin/coreclaw.js run ./examples/node-hello --min-results 1
node ./bin/coreclaw.js run ./examples/node-hello --require-status-ok
node ./bin/coreclaw.js run ./examples/node-hello --require-table-header
node ./bin/coreclaw.js run ./examples/node-hello --require-output-schema-match
node ./bin/coreclaw.js run ./worker --local-proxy --require-proxy-usage
node ./bin/coreclaw.js run ./browser-worker --require-browser --min-results 1
node ./bin/coreclaw.js run ./lightpanda-worker --lightpanda-shim --require-lightpanda-shim --min-results 1
node ./bin/coreclaw.js run ./browser-worker --captcha-solver --require-captcha-solver --min-results 1
```

`run` 会启动本地 CoreClaw SDK gRPC server，监听 `127.0.0.1:20086`，然后执行 worker。

`--timeout-ms` 用于限制整个 worker 进程运行时间；`--idle-timeout-ms` 用于停止已经不再输出但仍有 Node/Python/Go handle 未退出的 worker。时长支持毫秒、`s` 和 `m`。

如果 input schema 把某个字段标记为 required，本地 run 也要求该字段有非空值。声明字段还必须匹配 schema 类型，例如 `integer` 必须是整数，`boolean` 必须是布尔值，`array` 必须是 JSON 数组。声明了 `minimum` / `maximum` 的数值字段必须落在边界内。选择器输入必须使用 `options` 里声明的值；`requestList`、`requestListSource` 和 `stringList` 会按各自文档形态校验每个列表项。schema 没有提供 default 时，使用 `--input input.json` 或 `--json '{"field":"value"}'` 传入。

真实 worker 冒烟测试应使用 `--min-results`。有些 worker 会在上游或浏览器失败后仍以 exit code `0` 退出，因此结果行数才是更可靠的成功门槛。

当结果行里包含 `status` 字段，并且 `fail`、`failed`、`failure` 或 `error` 这类值应该让本地运行失败时，使用 `--require-status-ok`。不同 worker 可以用 `--result-status-fields status,check_status` 和 `--result-fail-values fail,error,manual` 调整字段和值。这个门槛默认不启用，因为有些 worker 会使用 `manual`、`skipped` 或业务自定义状态，它们不一定代表运行失败。

当上传前预检需要强制 worker 调用 SDK runtime table-header API 时，使用 `--require-table-header`。它比默认兼容模式更严格，可以捕获只依赖静态 `output_schema.json`、但没有设置 runtime 表头的 worker。

上传前验证建议加 `--require-output-schema-match`。默认行为继续兼容老 worker；显式启用后，输出字段和 `output_schema.json` 不一致会成为 hard failure。

每次运行都会得到独立临时目录 `.coreclaw/runs/<run-id>/tmp`。Node.js worker 还会默认预加载一个本地 hook，把绝对路径 `/tmp/...` 文件操作映射到该运行目录，避免宿主机旧 `/tmp` 状态影响重复运行。

如果 `http://127.0.0.1:9222/json/version` 可访问，CLI 会自动发现本地 Chrome browser WebSocket 路径并注入：

- `ChromeWs=127.0.0.1:9222/devtools/browser/<id>`
- `ChromeHttp=127.0.0.1:9222`
- `CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`
- `BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`

用 `--no-discover-chrome` 可关闭自动发现。未检测到浏览器时，`ChromeWs` 和 `ChromeHttp` 都会回退为 `127.0.0.1:9222`，保持与 CoreClaw 文档中 host-style browser 变量一致的环境形态。`ChromeHttp` 用于 Selenium Remote WebDriver worker；`ChromeWs` 用于 Playwright、Puppeteer 和 DrissionPage CDP worker。

浏览器 worker 的 smoke test 建议加 `--require-browser`。它会把浏览器可用性变成预检门槛：本地 Chrome 自动发现成功时直接通过，host-style CDP 端点会检查 `/json/version`，Selenium 风格端点会检查 `/status`。如果没有任何端点可访问，命令会在创建 run 产物前失败，避免 worker 内部才报出不明确的浏览器连接错误。

测试应通过 CoreClaw host-style `ChromeWs` 变量连接浏览器的 worker 时，使用 `--browser-cdp-shim`。CLI 会启动本地 CDP WebSocket shim，注入 `ChromeWs=<host:port>`、`ChromeHttp=<host:port>` 和完整 `CDP_ENDPOINT`，并同时接受 `ws://<ChromeWs>/devtools/browser/<id>` 以及 DrissionPage 文档里的 `ws://<ChromeWs>/ws?apiKey=<PROXY_AUTH>` 路径。加上 `--require-browser-cdp-shim` 后，如果 worker 从未连接该 shim，run 会失败。

测试读取 CoreClaw 文档中 `LightpandaDomain` 变量的 worker 时，使用 `--lightpanda-shim`。CLI 会启动本地 CDP WebSocket shim，注入 `LightpandaDomain=<host:port>` 和 `PROXY_AUTH`，并接受文档要求的归一化端点 `ws://<LightpandaDomain>/devtools/browser/new`。加上 `--require-lightpanda-shim` 后，如果 worker 从未连接该路径，或连接时没有 Basic `Authorization` header，run 会失败。shim 会返回基础 `Browser.getVersion` 元数据；存在本地发现或显式传入的上游 CDP endpoint 时，其它 CDP 流量会继续转发。

测试会调用 CoreClaw 自定义 CDP 方法 `Captchas.automaticSolver` 的 worker 时，使用 `--captcha-solver`。CLI 会启动相同形态的本地 CDP WebSocket shim，并通过 `ChromeWs`、`CDP_ENDPOINT` 和 `BROWSER_WS_ENDPOINT` 注入该端点，对 `Captchas.automaticSolver` 返回 `{ "status": true }`。其它 CDP 消息会在存在本地或显式上游 CDP 端点时继续转发。加上 `--require-captcha-solver` 后，如果本次运行没有观察到 solver 调用、`timeout` 不是正数、或 `solverType` 不在 CoreClaw 官方映射表中，run 会失败。观测到的 solver 调用会写入 `captcha_solver_calls.json`。

运行产物：

```text
.coreclaw/runs/<run-id>/
  input.json
  env.json
  command.json
  upload_manifest.json # staged verify 使用的上传文件清单
  logs.ndjson
  results.ndjson      # SDK push_data 原始 payload
  export.ndjson       # 按 output_schema 投影后的 CoreClaw 风格输出
  output_schema_issues.json # pushed rows 与 output_schema.json 不一致时存在
  captcha_solver_calls.json # --require-captcha-solver 观察到 solver 调用时存在
  table_headers.json
  tmp/                # 每次运行独立临时状态
  summary.json
```

`summary.json` 会记录 `project_dir` 和 `worker_dir`。普通 `run` 中两者相同；staged `verify` 中，`project_dir` 是保存产物的原 worker 目录，`worker_dir` 是临时上传包视角执行目录。

### 上传前预检

```bash
node ./bin/coreclaw.js verify ./examples/node-hello --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --timeout-ms 10m --idle-timeout-ms 30s --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --cloud-output ./cloud-output.json --min-shared 1 --max-diff 0
node ./bin/coreclaw.js verify ./worker --no-staging --no-install
node ./bin/coreclaw.js verify ./worker --no-pack
node ./bin/coreclaw.js verify ./my-go-worker --go go --min-results 1
node ./bin/coreclaw.js verify ./worker --require-status-ok --min-results 1
node ./bin/coreclaw.js verify ./worker --require-table-header --require-output-schema-match --min-results 1
node ./bin/coreclaw.js verify ./worker --require-output-schema-match --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --require-browser --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --browser-cdp-shim --require-browser-cdp-shim --min-results 1
node ./bin/coreclaw.js verify ./lightpanda-worker --lightpanda-shim --require-lightpanda-shim --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --captcha-solver --require-captcha-solver --min-results 1
node ./bin/coreclaw.js inspect-package ./dist/my-worker.zip --language node
node ./bin/coreclaw.js inspect-package ./dist/my-go-worker.zip --language go
```

`verify` 是上传前门槛。它会执行静态校验，把可上传 worker 文件复制到 `.coreclaw/staging/<stage-id>/`，在 staging 目录安装依赖，从 staging 目录启动本地 CoreClaw runtime 执行 worker，校验结果行数，可选在结果行包含失败状态值时失败，可选强制要求 runtime table-header 调用，可选强制校验结果与 `output_schema.json` 一致，可选对比 CoreClaw 云端 JSON 导出，并在未传 `--no-pack` 时创建上传 ZIP。

这种默认行为能捕获只因为源目录里存在 `.coreclaw`、`node_modules`、`dist` 或其他不会上传的文件而本地跑通的假阳性。

对于 Go worker，`verify` 现在把源码文件和运行时文件视为两个不同的平台契约。它会先在干净的源码 staging 中校验并构建上传产物：`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o main ./main.go`。随后再用第二个上传视角的 runtime staging 执行 worker，这个运行目录只包含编译后的入口二进制和 schema 文件，而不是原始 Go 源码树。这匹配当前 CoreClaw 平台观察到的行为：Go 运行时可以看到 `main`，但 worker 进程不一定能看到 `main.go`、`go.mod` 和 `GoSdk/`。需要调试源码目录时使用 `run` 的 `go run .`；上传前门槛使用 `verify`。需要固定 Go 工具链或 `go` 不在 `PATH` 时，使用 `--go <binary>`。

默认情况下，运行产物仍写入原项目 `.coreclaw/runs/<run-id>/`；上传包默认写入 `.coreclaw/verify/<verify-id>/`；云端对比报告默认写入 `.coreclaw/runs/<run-id>/cloud-comparison.json`。staged preflight 还会在 run 目录写入 `upload_manifest.json`，用于审计到底哪些文件进入了上传包视角的执行目录。`--no-staging` 或 `--no-install` 只建议用于直接调试源目录行为。

### 检查运行产物

```bash
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --min-results 1
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --require-status-ok
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --require-status-ok --result-status-fields check_status --result-fail-values fail,error,manual
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --require-output-schema-match
```

`inspect-run` 会检查 `summary.json`、`results.ndjson`、`export.ndjson` 和 `output_schema_issues.json` 的一致性，也可以对已经捕获的运行产物应用同一套结果状态门槛。真实 worker 执行后应使用它，避免把“进程正常退出”误判为“产生了可用数据”。

### 模拟拆分任务

CoreClaw 的 `input_schema.b` 是任务拆分 key，必须指向一个数组 property。用 `--split <index>` 可以在本地运行一个展开后的单项任务：

```bash
node ./bin/coreclaw.js run ./examples/node-hello --split 0
```

对于 `{ "url": "https://example.com" }` 这样的 `requestList` 项，worker 会收到顶层 `url`，匹配现有 CoreClaw worker 常见的单项任务输入形态。

### 运行环境覆盖

```bash
node ./bin/coreclaw.js run ./worker \
  --proxy-auth "user:pass" \
  --proxy-domain "proxy.example:6000" \
  --chrome-ws "127.0.0.1:9222" \
  --chrome-http "127.0.0.1:9222" \
  --lightpanda-domain "lightpanda-inner.coreclaw.com"
```

默认本地运行使用直连网络：

- 不设置 `PROXY_AUTH`
- 不设置 `PROXY_DOMAIN`
- `ChromeWs` 优先从本地 Chrome CDP 自动发现；否则为 `127.0.0.1:9222`
- `ChromeHttp` 默认跟随 `ChromeWs` 的 host/port，也可以为 Selenium worker 显式设置
- `LightpandaDomain` 默认不设置，除非显式传入 `--lightpanda-domain` 或启用 `--lightpanda-shim`

`coreclaw doctor` 会检查 `127.0.0.1:9222` 的本地 Chrome CDP 是否可访问，并打印本地运行会注入的 browser 变量。

如需模拟 CoreClaw 的 SOCKS5 代理路径，可以启动本地代理：

```bash
node ./bin/coreclaw.js run ./worker --local-proxy
node ./bin/coreclaw.js verify ./worker --local-proxy --require-proxy-usage
```

`--local-proxy` 会在 `127.0.0.1:<port>` 启动带认证的 SOCKS5 代理，并注入匹配的 `PROXY_AUTH` / `PROXY_DOMAIN`。`--require-proxy-usage` 也会启用该代理，并在 worker 从未发起 SOCKS5 CONNECT 时让 run 失败。HTTP 请求型 worker 应使用这个门槛，避免代码只是因为本机直连网络而跑通。

浏览器 worker 使用非默认端点时，把 `--require-browser` 和 `--chrome-ws` 或 `--chrome-http` 搭配使用：

```bash
node ./bin/coreclaw.js verify ./worker --chrome-ws "127.0.0.1:9222/devtools/browser/<id>" --require-browser --min-results 1
node ./bin/coreclaw.js verify ./worker --chrome-http "127.0.0.1:9515" --require-browser --min-results 1
```

第一种对应 Playwright、Puppeteer 和显式 CDP endpoint worker；第二种对应 Selenium Remote WebDriver worker。

对于使用 CoreClaw host-only CDP 变量的 worker，尤其是会拼出 `ws://{ChromeWs}/ws?apiKey={PROXY_AUTH}` 的 DrissionPage worker：

```bash
node ./bin/coreclaw.js verify ./worker --browser-cdp-shim --require-browser-cdp-shim --min-results 1
```

没有上游浏览器时，shim 也会返回基础 `Browser.getVersion` 元数据；存在本地发现或显式传入的上游 CDP endpoint 时，其它 CDP 流量会继续转发。

对于会把 `LightpandaDomain` 归一化为 `ws://<domain>/devtools/browser/new`，并用 `PROXY_AUTH` 发送 Basic auth 的 Lightpanda worker：

```bash
node ./bin/coreclaw.js verify ./worker --lightpanda-shim --require-lightpanda-shim --min-results 1
```

如果想连接显式真实端点而不是本地 shim，使用 `--lightpanda-domain <domain-or-endpoint>`。裸域名会原样放进 `LightpandaDomain`，让 worker 自己按文档规则归一化；本地 run 只要存在 `LightpandaDomain` 就会同时注入 `PROXY_AUTH`。

对于带 CAPTCHA 处理逻辑的浏览器 worker：

```bash
node ./bin/coreclaw.js verify ./worker --captcha-solver --require-captcha-solver --min-results 1
```

这个本地 shim 用来证明代码按预期发送了 `Captchas.automaticSolver` CDP 调用。启用 `--require-captcha-solver` 时，它还会校验 `timeout` 必须是正数，`solverType` 必须是 CoreClaw 官方文档列出的值之一：`cloudflare`、`datadome`、`google-v2`、`google-v3`、`oocl_slide`、`perimeterx`、`shein_same_object_click`、`temu_auto`、`tiktok_slide_simple` 或 `tiktok_slide_auto`。它不会绕过真实网站挑战；真实目标上的求解效果仍需在 CoreClaw 云端指纹浏览器里验证。

如需模拟 CoreClaw 云端代理变量但没有真实代理，可以显式使用：

```bash
node ./bin/coreclaw.js run ./worker --cloud-proxy
```

cloud proxy mode 会暴露本地占位变量：

- `PROXY_AUTH=coreclaw-local:coreclaw-local`
- `PROXY_DOMAIN=127.0.0.1:6000`

### 打包上传

```bash
node ./bin/coreclaw.js pack ./examples/node-hello --output ./dist/node-hello.zip
node ./bin/coreclaw.js pack ./my-go-worker --output ./dist/my-go-worker.zip --go go
```

ZIP 会把 worker 入口文件放在 archive root，并排除 `.coreclaw`、`node_modules`、virtualenv、构建产物、缓存和 git metadata。创建 ZIP 后，`pack` 会立即执行与 `inspect-package` 相同的包检查门槛；根目录入口错误和 Go 可执行权限问题会在上传前直接失败。`verify` 的最终上传产物也由 `pack` 生成，因此这个包检查同样属于上传前预检。

对于 Go worker，`pack` 会在临时 staging 目录构建 Linux amd64 上传可执行文件，并把带可执行权限的 `main` 加入 ZIP。源目录不会被修改。

如果需要在上传前检查一个已有 ZIP，尤其是这个 ZIP 不是由 `coreclaw pack` 生成的，使用 `inspect-package`。它会检查 Python、Node.js 或 Go 的入口文件是否位于 archive root，并报告常见的“多套了一层 worker 目录”问题，例如 ZIP 里是 `worker/main.js` 而不是根目录 `main.js`。对于 Go 上传包，它还会验证 ZIP 根目录存在可执行文件 `main`，并且 Unix mode 是 `100755`，可以提前发现 Windows 压缩工具丢失可执行权限导致平台在 worker 日志出现前直接失败的问题。

## 云端输出对比

当你有 CoreClaw 云端 run 导出的 JSON 或 CSV，可以把它和本地 run 捕获的结果对比：

```bash
node ./bin/coreclaw.js compare \
  E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  E:/worker/worker-username-finder/.coreclaw/runs/<run-id> \
  --output ./tmp/username-finder-comparison.json \
  --compare-profile E:/worker/worker-username-finder/.coreclaw/profiles/cloud-parity.json \
  --min-shared 1
```

云端路径可以是 JSON 数组导出、保存下来的 `/api/v1/run/result/list` 响应（例如 `data.list[]`），也可以是下载后的 CSV 导出。如果传入的是 `/api/v1/run/result/export` 返回的只包含 `data.download_url` 的响应，需要先下载这个文件，再对下载得到的 JSON/CSV 做 compare。CSV 字段会按字符串保留；如果 `--require-output-schema-match` 需要区分数字、布尔和字符串，优先使用 JSON。

该命令会对比行数、shared keys、cloud-only rows、local-only rows 和 value differences。差异报告会给每个变化行写出 `changed_fields`，并汇总 `value_diff_fields_top_20`，方便先区分时间戳/噪音字段和真正的合同漂移。使用 `--ignore-fields completed_at,updated_at` 可以在 value diff 计算前移除已知噪音字段；status 和 output_schema 门槛仍然检查原始结果行。当某些已知运行档位会刻意产出不同 row identity 时，例如平台侧细分 browser probe 行、本地侧 skipped group 行，可以用 `--ignore-keys key1,key2` 或 `--ignore-keys-file <file>` 只把这些 key 从 duplicate/shared/only/value-diff 统计中移除；status 和 output_schema 门槛仍然检查原始结果行。ignore-keys 文件可以是 JSON 数组、带 `ignore_keys` 或 `ignoreKeys` 字段的 JSON 对象，或一行一个 key 且支持 `#` 注释的纯文本文件。它也会分别报告两侧重复 comparison key；加入 `--require-unique-keys` 后，如果当前 key 会导致 last-row-wins 覆盖行，命令会失败。它也会分别报告 CoreClaw 云端输出和本地输出里的结果状态问题。加入 `--require-status-ok` 后，只要任一侧包含失败状态值，命令就会失败。传入 `--output-schema <file>` 后，还会用 worker 的 `output_schema.json` 校验云端和本地结果行；加入 `--require-output-schema-match` 后，schema 漂移会成为 hard gate。本地路径可以是 run 目录、`export.ndjson` 或 `results.ndjson`。默认 key 不够具体时可使用 `--key-fields username,site,urlUser`。需要严格云端一致性时可使用 `--min-shared`、`--max-diff`、`--max-only-local`、`--max-only-cloud` 作为 CI gate。

使用 `--compare-profile <file>` 可以把反复使用的云端一致性门槛放进一个 JSON 文件。profile 支持 snake_case 或 camelCase 字段，例如 `key_fields`、`ignore_fields`、`ignore_keys`、`min_shared`、`max_diff`、`max_only_cloud`、`max_only_local`、`require_unique_keys`、`require_status_ok`、`output_schema`、`require_output_schema_match`。profile 里的 `output_schema`、`ignore_keys_file`、`output` 等相对路径会按 profile 文件所在目录解析，而不是按当前 shell 目录解析。命令行参数会覆盖 profile 中的同名值；`ignore_fields` 和 `ignore_keys` 会合并，便于临时追加一次性忽略项而不修改 profile。

同一个 profile 传给 `verify` 时，也可以携带一小组上传前运行默认项：`local_proxy`、`cloud_proxy`、`proxy_auth`、`proxy_domain`、`browser_cdp_shim`、`require_browser_cdp_shim`、`lightpanda_shim`、`require_lightpanda_shim`、`captcha_solver`、`require_captcha_solver`、`require_proxy_usage`、`require_browser`、`require_status_ok`、`require_result_status_ok`、`result_status_fields`、`result_fail_values`、`lightpanda_domain`、`chrome_ws` 和 `chrome_http`。这样 worker 专属的云端一致性 profile 可以自包含，例如 docs-contract profile 可以设置 `local_proxy: true`，以后每次 verify 都不需要重复传 `--local-proxy`；如果本地 local 行会故意把平台注入变量报告为缺失，而云端输出才是最终通过依据，也可以设置 `require_status_ok: false`。显式命令行参数仍然会覆盖 profile 默认值。

也可以把对比合并进上传前预检：

```bash
node ./bin/coreclaw.js verify ./worker \
  --input input.json \
  --cloud-output E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  --compare-output ./tmp/username-finder-comparison.json \
  --compare-profile E:/worker/worker-username-finder/.coreclaw/profiles/cloud-parity.json \
  --key-fields username,site,urlUser \
  --min-shared 1 \
  --max-diff 0
```

`verify` 收到 `--cloud-output` 时，schema 优先级是：显式 `--output-schema` 优先，其次是 profile 里的 `output_schema`，没有 compare profile 时才默认使用当前 worker 自己的 `output_schema.json`。

网络较重的 worker 如果本地机器没有等价的 CoreClaw 代理/浏览器基础设施，输出可能与云端不同。此时应记录差异，而不是直接把行数漂移视为 CLI runtime 失败。

## 开发

本地验证 gate、runtime 兼容规则和真实 worker smoke matrix 见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 本机验证记录

当前 Windows 机器上已验证：

```bash
node ./bin/coreclaw.js validate ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js validate ./examples/python-hello
node ./bin/coreclaw.js doctor --python "py -3" --strict
node ./bin/coreclaw.js run ./examples/python-hello --python "py -3"
```

Python 示例使用 `--python "py -3"`，因为当前机器的默认 `python` 指向一个没有 `pip` 的 Hermes venv。`verify` 安装依赖时也会使用同一个 `--python` 配置，所以 Python worker 优先使用 `--python`，不要依赖 `--command`。上传前脚本可以加 `doctor --strict`，让 Node、npm、Python、pip 或 Go 缺失时直接失败。

真实 worker 开发期间 smoke run：

```bash
# Node.js，无浏览器依赖
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-dedup-datasets --input %TEMP%/coreclaw-dedup-smoke-input.json --timeout-ms 30s --idle-timeout-ms 10s
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-dedup-datasets/.coreclaw/runs/<run-id> --min-results 2

# Python，显式解释器
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-yfinance --input %TEMP%/coreclaw-yfinance-smoke-input.json --python "py -3" --timeout-ms 60s --idle-timeout-ms 20s --min-results 1

# Go，浏览器/CDP worker
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-google-maps-scraper --input %TEMP%/coreclaw-google-maps-smoke-input.json --chrome-ws 127.0.0.1:9222/devtools/browser/<id> --require-browser --timeout-ms 90s --idle-timeout-ms 30s
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-google-maps-scraper/.coreclaw/runs/<run-id> --min-results 1
```

## 使用的官方文档契约

实现依据本地官方文档：

- `E:\worker\knowledge-files\docs\developer-guide\develop-worker\quick-start.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\project-structure.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\sdk-modules.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\input-schema.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\output-schema.md`
- `E:\worker\knowledge-files\docs\developer-guide\builds-and-runs.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\platform-features\proxy-support.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\platform-features\browser-fingerprinting.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\browser-automation\lightpanda.md`
