# Codex ↔ ZCode 桌面任务中继

Codex 主管通过 `zcode-bridge` controller MCP 派发独立任务；ZCode 桌面常驻会话通过 `codex-relay` worker MCP 接收任务，以指定原生 agent profile 启动后台子 agent，并回报结果。通信使用本地 named pipe 和事件等待，不需要任务轮询、cron 或另做 CLI OAuth。

Windows、Node.js 24 及已登录的 ZCode 桌面是当前目标环境。按 [INSTALLATION.md](INSTALLATION.md) 安装依赖、生成本机配置，再启动 controller 和 worker。生成器仅写配置和 profile 副本；不会修改应用设置或用户 home。

也提供 [Codex 直连 GLM 配置与执行器](integrations/glm/README.md)：复用本机 ZCode 保存的 Coding Plan API Key，启动独立 GLM Codex 进程并等待真实完成，不需要桌面 worker。该方式已验证模型 API 与文件工具；当前 Codex 0.162.1 的 GPT 原生子 agent 仍不能跨供应商切换到智谱。两种接入方式分别使用各自的安装说明。

## 任务闭环

1. worker 核验桌面账户模型、实际载入的原生 profiles、工具和 MCP 超时设置，调用 `register_worker` 后保持 `receive_task` 等待。
2. 主管调用 `zcode_models` 确认可用项，以 `zcode_spawn` 指定 workspace、prompt、providerId、modelId 和 effort，获得 taskId。
3. worker 按精确 profile 创建后台原生子 agent，并继续等待；子 agent 用 taskId 与 lease 调用 `report_result`。
4. 主管保持当前回合，调用 `zcode_wait` 接收结果并独立验收。单次等待最多 55 秒；返回 `timedOut` 后继续下一段事件等待，直到真实终态。不因单次超时结束主管回合。
5. `zcode_send` 派发新的返修任务和子 agent，并携带前次任务与结果上下文；验收完成后收尾。

标准 MCP 无法唤醒已经结束的 Codex 回合。主管在途等待时需保持回合，ZCode worker 会话也必须持续存活。worker 提示模板见 `templates/worker-prompt.txt`。

## 9 个原生 profiles

provider 为 `account:bigmodel-individual-coding-plan`。`profiles.json` 列出以下模型与 `low`、`high`、`max` 的全部组合：

| 模型 | profile 名称前缀 | effort |
| --- | --- | --- |
| GLM-5.3-Flash | codex-relay-glm53-flash- | low / high / max |
| GLM-5.3-FlashX | codex-relay-glm53-flashx- | low / high / max |
| GLM-5.3 | codex-relay-glm53- | low / high / max |

worker 只能注册实际可用的 profiles。provider、model 和 effort 精确匹配；没有匹配项则失败。其它账户 provider 或模型需要自行提供匹配的原生 profile 与注册清单。

## 生命周期与边界

broker 仅由 controller 自动启动，worker 找不到服务时明确提示先启动 controller。没有客户端连接 5 分钟后 broker 退出；阻塞等待中的连接保持服务存活。任务状态仅保存在内存，断连或重启不会改派或重放任务。

`receive_task` 收到 MCP `notifications/cancelled`、触发 SDK 取消信号时，会立即关闭并注销整个 worker 连接，清除接收订阅，使其未完成任务失败，防止旧订阅领取新任务。后续工具明确要求重载 worker MCP 并重新启动路由器。普通会话结束或停止路由器若未产生取消通知或连接关闭，不能自动召回旧接收；需明确停止旧连接，再启动 worker。controller 连接断开后，仅在下一次明确工具调用且连接为空时尝试一次有界重连；并发调用共享同一尝试，失败后允许后续明确调用重试，没有后台轮询或定时重连。broker 重启后的旧 taskId 会如实返回 Unknown task。worker 始终不自动重连。

排队任务可以立即取消；运行任务的取消是协作请求，由 worker 使用真实原生 agentId 调用 TaskStop，确认停止后回报 cancelled。收到请求不表示原生执行已经停止。`report_result` 表示执行完成，最终验收由主管负责。

`cancel_requested` 不满足 `zcode_wait` 的完成条件；等待继续阻塞直到真实终态或本段超时。注销 worker、将任务标记 failed 也不证明原生后台 Agent 已停止，仍需按 TaskStop 流程确认。

controller 校验 workspace 的实际路径是否在允许根目录内，这不构成操作系统沙箱。任务仍受原有用户授权约束。运行状态含本地认证 token；任务结果也可能含私有材料，不应公开。生命周期日志仅记录进程、连接和错误代码，不记录 token、lease、prompt 或结果。

原生 MCP `timeoutMs:2147483647` 约为 24.85 天，receive_task 不定时返回；此设置不是无限超时。worker 遇到断线、权限或原生超时问题时应明确报告阻塞。钩子未启用，仅是未来辅助方向。

## 验证

`npm test` 验证协议、事件等待、精确路由、lease、取消、断连、workspace 以及真实本地 pipe 与生命周期。`npm run verify` 验证真实 stdio MCP 工具发现和派发、领取、回报、等待、返修、排队取消；此验证使用假模型，不调用模型推理。

测试、协议验证及 setup fixture 使用仓库被忽略的 `runtime/test/` 下 `mkdtemp` 创建的专属临时根，只清理本进程登记的具体根目录；不依赖仓库外层路径，也不扫描或删除其它目录。

真实 `GLM-5.3-Flash / low` 桌面子智能体已完成 150.005 秒任务，主管经历两次完整的 55 秒超时后收到结果并独立验收。真实桌面停止接收后也确认 worker 已注销。详情及当前聊天工具连接缓存的限制见 [ACCEPTANCE.md](ACCEPTANCE.md)，脱敏字段见 [long-wait-evidence.json](long-wait-evidence.json)。本仓库不包含账户原始请求、运行状态或历史 CLI 引擎实验。

## 下次手工启动

两端 MCP 配置与 profiles 安装一次后，下次在 ZCode 启用或重载 `codex-relay`，新开桌面会话，选择 `GLM-5.3-Flash / low`，发送生成的 `worker-prompt.txt`。让它注册 worker 并保持 `receive_task`，主管确认连接后即可直接派发。接收被停止后应按安装说明重载 worker，旧任务不会自动补执行。
