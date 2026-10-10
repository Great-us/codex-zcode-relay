# 权限与资源生命周期

外部 subagent 与主管共享用户授权的任务范围，但不自动共享主管的全部实际工具、账户、系统权限或审批机制。

| 路径 | 当前限制方式 | 已证明与未证明 |
| --- | --- | --- |
| OpenCode | 本机 OpenCode 配置、进程的系统权限、任务专属 `--permissions-file` | 已验证精确文件 read/write；未验证与主管权限完全等价。默认拒绝 external_directory 和交互 question，其余规则可能沿用用户配置 |
| Codex CLI GLM | runner 指定 `workspace-write`、Windows `unelevated`、`--ignore-user-config`、禁用 computer_use 与 web_search，审批策略 never | 已验证文件和命令任务；不继承主管已有 MCP，不绕过沙箱失败以扩大权限 |
| ZCode MCP | controller 解析真实 workspace 路径并校验允许根，桌面 agent 使用其自身工具与应用权限 | 目录校验不是操作系统沙箱；不能保证任务提示里的文件边界被系统强制执行 |
| 内部 CLI 实验 | tools allowlist、workspace 检查、拒绝自动审批 | 未完成认证／真实模型验收，不用于生产任务 |

## OpenCode 权限文件

对读写任务可用 `"*":"deny"` 后仅允许指定文件，runner 会将绝对 read/edit 路径转换为 OpenCode worktree 相对路径；不同工具仍有各自规则。需要 shell、网络、MCP 时单独明确授予。允许 shell 后，文件工具的目录规则不能代替 shell 的系统访问边界；不得把“禁止 external_directory”描述为完整 OS 隔离。

配置模型和强度已验证，不表示所有权限都已经对齐。外部进程启动在什么系统环境下，会影响它能访问的资源；应采用完成任务所需权限，不能因为名称是 subagent 就给予无限授权。

## 等待与终态

OpenCode 和 Codex CLI 执行器等待自己的真实进程退出，不设置任务总时限。主管工具可能按单段时间返回 session ID，应继续对同一进程做完成等待。ZCode MCP 的 `zcode_wait` 每段最多 55 秒，`timedOut` 时继续事件等待，不能改成 `zcode_status` 定时查询。

`completed`、`executionCompleted`、退出 0 不能代替主管验收。failed、cancelled、断连与 broker 重启也不能自动证明 ZCode 后台原生 agent 已停止；取消运行任务需真实 TaskStop 与回报确认，具体未验证范围见 [ACCEPTANCE.md](../ACCEPTANCE.md)。

## 收尾

- 一次 OpenCode/Codex GLM 任务：等待该任务进程完成，检查产物，关闭该任务独占的临时客户端；保持用户其它服务运行。
- ZCode MCP：任务完成不必整体停止共享 broker 和父路由器。若用户明确要求停止接收，按中断清理与 worker 注销流程处理；停止模型与断开 MCP 为两件事。
- 验证 probe：关闭该次临时本机转发服务；认证只在内存中转发到固定智谱 HTTPS 端点，不保存 Authorization、Key、原始请求或思考文本。
- 可复用本机认证不等于可将认证打包进仓库。默认忽略 runtime、generated、状态数据库、日志、任务输出与安装回执，发布前仍检查实际暂存清单。
