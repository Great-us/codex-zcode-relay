# 验收记录（2026-10-10）

## 真实桌面长任务

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
