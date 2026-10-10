# 安装与启动

需要 Node.js 24、Codex 及已登录的 ZCode 桌面。克隆或下载后，在仓库目录执行：

```sh
npm install
node setup.cjs --workspace "<允许工作的绝对目录>"
```

生成器写入仓库的 `generated/`：`codex.mcp.json`、`zcode.mcp.json`、9 个原生 profile 副本与 `worker-prompt.txt`。默认状态目录为仓库 `runtime/state/`。可用 `--state`、`--out` 指定绝对目录，`--worker-id` 指定 worker 名称。生成器不会连接应用、修改用户 home 或自动写入应用设置。

## 连接两端

将生成的 controller 配置作为 Codex stdio MCP `zcode-bridge` 安装，参数为当前仓库的 `relay-mcp.cjs controller`。先启动并连接 controller，由它创建本地 broker。

将生成的 worker 配置作为 ZCode stdio MCP `codex-relay` 安装，参数为同一个 `relay-mcp.cjs worker`。两端 `ZCODE_RELAY_STATE` 必须相同。worker 必须使用 `timeoutMs:2147483647`；`0` 不能禁用 ZCode 原生执行器超时，默认短超时会终止接收等待。

依照 ZCode 原生 agent profile 的安装方式，将 `generated/profiles/` 中的 9 个文件放入它实际加载的 profile 目录。生成器只暂存副本，不写任何应用目录。安装后新建桌面会话，核对原生 Agent 工具列出的 subagent_type；仅看到磁盘文件不证明会话已加载。

父 worker 会话选择指定 provider 的 `GLM-5.3-Flash` 与 `low`，并核验模型和工具实际可用。把 `generated/worker-prompt.txt` 发送给此桌面会话，让它核验、注册并保持事件接收循环。不要在设置页短暂连接测试中启动 worker 路由器。

## 主管使用

controller 提供 `zcode_spawn`、`zcode_wait`、`zcode_status`、`zcode_models`、`zcode_cancel`、`zcode_send`。worker 提供 `register_worker`、`receive_task`、`report_result`、`report_progress`。

主管派发后先继续独立工作；无可推进工作时保持当前回合并调用 `zcode_wait`。单次 55 秒超时后继续下一段事件等待，直到真实终态；再验收、返修或收尾。标准 MCP 无法恢复已经结束的主管回合。桌面 worker 也需持续存活。

## 验证与故障处理

```sh
npm test
npm run verify
```

这些命令不调用真实模型。真实验收需额外确认桌面原生子 agent 的 profile、模型、effort 与结果，并验证超过 55 秒的跨段等待。

所有协议状态和 setup fixture 都位于被忽略的仓库 `runtime/test/`，使用 `mkdtemp` 专属前缀分配。退出时仅删除已登记并核验的具体临时根；克隆到短路径也不会写入仓库外的 `work` 目录。

状态目录中的 `broker-info.json` 记录 PID、PPID、启动时间、owner；`lifecycle.jsonl` 记录连接、退出和错误代码。`relay.json` 含认证 token，不应分享。broker 崩溃或 worker 断连后不自动重放任务，先核对受影响任务再明确重连；保持授权边界。

接收调用收到 MCP `notifications/cancelled` 时，SDK 取消信号会关闭并注销 worker 连接，清除残留订阅，使未完成任务失败。恢复需要重载 ZCode 的 worker MCP，再启动新的路由器会话并注册；旧连接上的后续工具会明确拒绝。普通停止路由器若没有取消通知或断连，不会自动召回旧接收，需明确停止连接并重新启动 worker。controller 断连后，在下一次明确工具调用时进行一次有界重连；并发工具共享该尝试，失败后由下一次明确调用决定是否再试。没有后台 timer、轮询或无限重试，也不会重放旧任务；broker 重启后旧 taskId 返回 Unknown task。worker 不自动重连，仍需重载 worker MCP 并启动路由器。

中继断连与 failed 状态不代表原生后台 Agent 已停止，仍须用真实 agentId 调用 TaskStop 并确认。主管等待只在 completed、failed、cancelled 真终态返回结果；取消请求本身不会让等待立即完成。

更新服务源码后需重载对应 MCP 进程。Codex 当前聊天的原生工具连接可能缓存旧进程，重新打开设置不保证当前回合加载新版；必要时在新聊天或重启客户端后确认所加载的服务。新 controller 按明确调用重连的行为只适用于已经加载新版源码的 MCP 进程。移动仓库或 Node 路径变化后重新生成配置。移除时分别删除两端 MCP 设置和手工安装的 profiles。运行目录及 `generated/` 已被 `.gitignore` 排除，发布前仍需检查暂存清单。
