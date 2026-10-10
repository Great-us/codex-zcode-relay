# Codex 直连智谱 GLM

本机 Codex 已配置智谱 Coding Plan Responses API：`https://open.bigmodel.cn/api/v1`。认证命令按需读取 ZCode 本机保存的 Coding Plan Key；配置、任务参数和代码仓库不保存 Key 副本。

提供 GLM-5.3-Flash 和 GLM-5.3 的六种配置：

| 模型 | `--model` | `--effort` | 已安装 profile |
| --- | --- | --- | --- |
| GLM-5.3-Flash | `flash` | `low` / `high` / `max` | `glm-flash-low` / `glm-flash-high` / `glm-flash-max` |
| GLM-5.3 | `full` | `low` / `high` / `max` | `glm-full-low` / `glm-full-high` / `glm-full-max` |

`run-glm.py` 启动独立的 GLM Codex 执行进程，适合作为主管派发的外部子 agent。先把目标、允许修改的文件、工作目录和验收标准写入 UTF-8 任务文件，再运行：

```powershell
python run-glm.py --model flash --effort low --workspace "C:\path\to\project" --prompt-file "C:\path\to\task.md"
```

执行器输出 Codex JSON 事件并等待进程真正结束，没有任务总时限。主管单次等待工具超时后应继续等待同一进程，收到结果后独立检查产物和测试；模型自称完成或进程返回 0 不等于验收通过。返修通过另一次明确的任务派发完成。执行结束后不保留接收任务的常驻模型会话。

执行器使用 `workspace-write` 和 Windows 非提升沙箱，显式指定官方供应商，并隔离其它用户级 MCP 配置。文件与命令工具在该沙箱内运行；遇到需要额外授权的操作会报错，由主管处理。执行器适用于已授权的文件与代码任务；授权范围须写进任务文件。

主管默认仍是 `gpt-6.1-sol / openai / high`。当前 Codex 0.162.1 的原生 `spawn_agent` 子 agent 会继承主管供应商，custom agent 文件中的 `model_provider` 不会应用。GPT 主管原生派给 GLM 的实测返回了“GLM model is not supported when using Codex with a ChatGPT account”。因此，**这套配置提供独立 GLM 执行进程，不会把 GLM 加入 ChatGPT 的模型列表，也不能让现有 GPT 主管的原生 spawn 接口切换到智谱**。无效的原生 agent 测试定义已撤除。

本机验收：六种模型与 effort 组合均获得 HTTP 200、对应模型的 completed 响应；GLM-5.3-Flash/low 成功通过命令读取、计算、写文件、读回验证。GLM-5.3/high 的执行器验收及完整结论见 [acceptance.json](acceptance.json)。六项中 GLM-5.3/high 首次短回复不符合严格文本预期，单独复核后通过；该验证只能证明 API 接受参数，不衡量不同 effort 的推理质量。

在另一台相同环境的 Windows 机器安装时，需 Codex CLI 0.162.1、Python 3.11+，以及 ZCode 的 `~/.zcode/v2/config.json` 中已保存且可用的 `builtin:bigmodel-coding-plan` Key。运行：

```powershell
python install-glm.py
python "$env:USERPROFILE\.codex\glm-integration\read-zcode-key.py" --check
```

安装器根据当前 Python 和 home 路径渲染模板，先备份 `~/.codex/config.toml`，保留主管默认设置，添加供应商、模型目录和六个 profile。遇到同名但内容不同的配置会停止。不要直接安装含 `@...@` 占位符的源模板。`--check` 只确认 Key 存在；不要手工运行认证助手的无参数模式，因为其标准输出是 Codex 的凭据通道。ZCode 删除或更换本机 Key 后，认证助手会随之使用新的保存状态。

依据：[智谱官方 Codex 配置](https://docs.bigmodel.cn/cn/coding-plan/tool/codex)、[Codex 自定义供应商](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers)、[Codex 0.162.1 原生 agent role 覆盖实现](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/agent/role.rs#L32-L82)。
