# OpenCode GLM 外部执行 integration

## 这条路径解决什么问题

主管（Codex/GPT 会话）需要把一部分独立工作交给外部 GLM 执行进程。本 integration 用本机已安装的 OpenCode CLI（1.18.31 已验证）以 `--pure` 方式启动单任务进程：传入完整任务书文件、指定工作目录与任务级权限文件，等待进程真实退出后落盘结果与回执（`receipt.json`），并把 `supervisorAccepted` 初始化为 `false` 留给主管验收。主管保持自己的当前回合：可以同时推进独立工作，或直接等待子进程真实退出（无定时轮询）。runner 不提取或输出 API Key，OpenCode 使用已保存的本机认证。

## 环境

- OpenCode CLI 1.18.31（此版本已验收；升级版本必须重新复核行为，尤其是 permission 匹配与 `--variant` 语义）。
- Python 3.11（已验证），仅用标准库。
- 本机已预存并配置好智谱（zhipuai-coding-plan）认证；runner 不提取、不输出 Key，OpenCode 子进程直接使用既有本机认证。

## 直接运行（Windows PowerShell，单行可复制；`<...>` 占位符路径需替换为实际值，含空格路径已加引号）

```powershell
python integrations/opencode/run-opencode.py --model flash --effort low --workspace "<WORKSPACE>" --prompt-file "<TASK_FILE>" --result-dir "<RESULT_DIR>" --permissions-file "<PERMISSIONS_JSON>"
```

- `--model`：`flash`（glm-5.3-flash）或 `full`（glm-5.3）。
- `--effort`：`low` / `high` / `max`。
- `--result-dir` 必须是新的空目录（已有 `receipt.json` 会被拒绝），避免覆盖证据。
- `--permissions-file`：任务级权限 JSON，见 `examples/permissions/example-permissions.json`；替换 `<ABSOLUTE_FIXTURE_PATH>` 和 `<ABSOLUTE_OUTPUT_PATH>`，先拒绝再允许具体文件，最后匹配规则生效。默认 `external_directory` 与 `question` 为 `deny`，覆盖规则仍须符合用户授权。read/edit 规则中的绝对路径会按 Git worktree（非 Git 目录则按盘符根）相对化以匹配 OpenCode 1.18.31 的规则语义。对应 [任务示例](examples/tasks/example-task.md)与 [fixture](examples/fixture.json) 只使用 read/write，不需要 shell。
- 任务书必须是UTF-8 文本文件，经 `--file` 完整附件给子进程。
- **无任务总时限**：runner 一直等到 OpenCode 进程真实退出；终态（`executionCompleted`）只代表子进程自身完成，不等于主管验收（`supervisorAccepted=false`，验收由主管写入）。
- 不关闭任何共享服务；不读取/输出密钥；stderr 只计数不落盘（可能含用户上下文）。

## 并行

可以同时启动多个独立 runner 进程，各自独立结果目录、权限文件与文件所有权（建议独立 worktree）。已验收的是两路并行；更大规模未测。无定时轮询，由调用方等待进程退出。示例见 `examples/run-two-parallel.py`。

## 安装

```powershell
python integrations/opencode/install-opencode.py
python integrations/opencode/install-opencode.py --target "<DIR>"
```

默认安装 `run-opencode.py` 与本 README 到 `~/.codex/tools/opencode-glm`。预检全部文件后才写盘：内容不同的同名文件默认拒绝覆盖（避免部分写入），相同内容可重复安装（幂等）；可用 `--force` 显式覆盖。不操作 OpenCode 凭据与模型配置，不修改任何全局 AGENTS 规则（规则模板由主管提供）。

上面两行是默认安装和自选目录的两种选择，执行其中一种。只安装单任务 runner，不安装 probe、测试或并发示例；README 中仓库相对路径须在源码仓库内阅读或执行。安装后可调用 `python "$env:USERPROFILE/.codex/tools/opencode-glm/run-opencode.py"` 并传入上面的任务参数；合并全局规则见 [主管规则](../../docs/supervisor-policy.md)。安装副本的仓库相对文档链接应返回源码仓库阅读。

## 连通性探针（显式执行，消耗真实 GLM 配额）

```powershell
python integrations/opencode/probe-opencode.py --workspace "<WORKSPACE>" --result-dir "<NEW_RESULT_DIR>"
```

六个组合（flash/full × low/high/max），每轮最多两路并行；本机 127.0.0.1 临时端口起代理，固定转发到智谱官方 HTTPS 端点（不接受任意上游）；按"精确请求的 model + reasoning effort + HTTP 200"匹配实际 wire 请求，无匹配请求的组合不能通过；六个预期组合齐全且全部通过、且所有实际 wire 请求均属于预期组合并返回 HTTP 200 时，整体才判定通过并以 0 退出。结果目录必须尚不存在（任何已存在目录都会在启动代理与 OpenCode 之前被拒绝），避免覆盖证据。证据文件只保留白名单脱敏字段，不记录 Authorization/Key/原始请求/会话 ID/思考内容。**该探针自身消耗 GLM 配额，须显式运行，不加入默认离线测试。**

## 安全边界须知

- 工具权限（permission JSON）是 OpenCode 应用层规则，**不是操作系统沙箱**。
- 子进程**不会自动继承**主管的 MCP、审批流或内置工具；本 integration 只显式关闭 OpenCode 的 playwright MCP，**不能宣称禁用 OpenCode 的全部 MCP**，其余 MCP 以本机 OpenCode 配置为准——交付任务书时按"最小必要"检查并显式写全，**不要默认给全权**。
- 未在权限文件中显式声明的其余权限可能沿用本机 OpenCode 配置。
- 转发的认证只用于直达智谱官方端点，不落盘。

## 相关文档

- 路由总览：[../../docs/routes.md](../../docs/routes.md)
- 主管验收策略：[../../docs/supervisor-policy.md](../../docs/supervisor-policy.md)
- 探针与任务记录：[六组合与两路并发](acceptance/model-effort.json)、[真实文件任务](acceptance/file-task.json)。本次归档保留既有真实证据；整理后的 probe 只做离线验证，没有重新执行六次模型请求。
