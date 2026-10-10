# 验收记录（2026-10-10）

## 0.3 连接恢复修复

真实 ZCode 日志确认 MCP 已完成四个工具的初始化，但中断后的两次注册均被旧版“Worker receive was interrupted”锁定拒绝。0.3 将 stdio 初始化与 broker 连接分开，并允许明确重新注册恢复 worker；旧任务不重放，注册前拒绝接收和回报，没有后台重连。

`npm test` 20/20 通过；新增实际 stdio 测试验证 broker 尚未启动时两端均能完成 MCP 工具发现、后续连接和任务闭环。取消和 broker 重启测试验证同一 worker MCP 进程重新注册后领取新任务、拒绝旧 lease。`npm run verify` 通过。以上使用协议测试模型，不调用桌面 GLM。

随后完成 0.3 的真实桌面复验：controller 和真实 worker 注册均返回 `bridgeVersion:"0.3.0"`；`codex-relay-glm53-max` 原生子 Agent 执行恢复修复审查，14 次实际请求均为 `GLM-5.3 / max`。任务 `10a7f47e-a37d-4751-a00e-f159f27a8499` 经六次完整的 55 秒超时后，在第七段收到 completed，派发到回报约 7 分 34 秒。helper 实际执行 150,007 ms，结果为 361；主管独立核对原生 Agent 关联、请求元数据、helper 一次执行及文件写入范围，仓库未被子 Agent 修改。审查未发现四项恢复改动中的新可复现缺陷。脱敏字段见 [mcp-v3-evidence.json](mcp-v3-evidence.json)。

本次使用标准 MCP SDK 客户端连接同一生产服务；当前聊天的原生工具入口仍缓存旧 controller，其恢复尚未验收。没有使用 GUI 或智谱 API 直连替代桌面任务。真实桌面接收中断后的同进程重注册，以及运行子 Agent 的 TaskStop 取消，尚未在此次成功任务中单独复验；不能以协议测试或正常任务推断这些桌面行为已经通过。

## 真实桌面长任务

以下为先前 0.2 版本的历史验收，不能代替 0.3 的真实桌面复验。

ZCode 原生后台子智能体使用 `codex-relay-glm53-flash-low`，实际 provider 为 `account:bigmodel-individual-coding-plan`，模型 `GLM-5.3-Flash`，effort `low`。

主管通过真正的 stdio MCP 客户端调用 `zcode_spawn` 与 `zcode_wait`。本次当前聊天缓存的旧原生 MCP 连接不能正常重载，因此使用 MCP SDK 客户端连接同一个生产服务；未以模拟模型或 GUI 读取代替任务派发和回报。新聊天或客户端重载后的原生工具入口仍需另行核验。

子智能体运行限定工作目录中的测试 helper。helper 使用一次 150 秒定时器并计算 `19 * 19`，不会让模型持续生成内容来拖长时间。子智能体等待真正执行结束、读取并核验结果后，通过继承的 MCP 调用 `report_result`。

| 验证项 | 结果 |
| --- | --- |
| taskId | `5350d07f-b49b-4c11-bfbe-960a8971773b` |
| 原生 Agent | `agent_01b4daa7-4402-4fc0-b8d9-6062fa62070d` |
| helper 实际执行时间 | 150,005 ms |
| 第一次事件等待 | 55,027 ms，`timedOut:true` |
| 第二次事件等待 | 55,016 ms，`timedOut:true` |
| 第三次事件等待 | 收到真实 `completed` 结果 |
| 回报 | `ZCODE_LONG_WAIT_OK \| 361` |

主管始终保持本回合，等待之间处理独立的打包与验证工作。两次单段超时没有结束任务或主管回合。收回结果后独立核验 taskId 到原生 Agent 调用的关联、实际 profile、四次模型请求中的 provider/model/effort、helper 文件哈希及执行时间。脱敏字段见 [long-wait-evidence.json](long-wait-evidence.json)。

## 停止与故障清理

首次长测试发现真实故障：路由器此前被用户消息打断而停止，旧 MCP 接收订阅却仍存在，显示 worker 在线并领取了任务，但没有启动原生子智能体。主管没有将其记为成功；清理准确的旧连接后收回 `failed / worker_lost`，保留故障证据并修复。

修复后，MCP cancellation 通知触发 SDK 取消信号，关闭 worker 连接、清除订阅并注销。长任务验收后，在真实 ZCode 桌面点击停止接收，再用实际 MCP 客户端核验 `workers:[]`，未遗留假在线 worker。此验收针对父路由器的接收清理；运行中子 Agent 的 TaskStop 取消仍未单独完成桌面端到端验收。

另修复了无效 JSON 请求可能退出 broker，以及取消请求被反复作为完成事件返回的问题。controller 可在下一次明确工具调用时进行一次有界重连；无后台轮询、无任务重放。worker 仍需手工启动或重载。

## 自动化协议验证

独立 `npm install --ignore-scripts` 安装固定 SDK `1.32.1`，依赖审计为 0 项已知问题。`npm test` 19/19 通过，包含真实 named pipe、实际 stdio MCP cancellation、controller 重启恢复、精确模型路由、lease、事件等待、取消、断连、workspace 边界及配置生成。`npm run verify` 的真实 stdio MCP 派发、领取、回报、等待、返修及排队取消均通过；这些协议测试不调用真实模型。

## 使用范围

此版本支持用户手工启动 ZCode 路由器后，由主管通过 MCP 派发并持续等待到验收完成。MCP 服务连接与路由器模型会话运行是两项必要条件。它不会自动启动已经停止的 ZCode 模型引擎，也不会唤醒已经结束的 Codex 回合。软件更新后的当前聊天可能缓存旧 MCP 进程，需重载或在新聊天核验连接。

仓库只包含代码、配置模板、原生 profiles、启动提示、测试和脱敏验收记录。不含本机认证状态、token、lease、原始模型请求、账户日志或个人绝对路径。
