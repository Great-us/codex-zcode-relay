# 验证索引

离线检查与真实模型验收分别记录；前者不消耗模型配额，也不证明真实模型已经完成工作。真实证据来自 2026-10-10 的本机验收，本次归档不会重新运行旧长任务或重试失败 OAuth。

| 路径 | 离线检查 | 真实模型证据 |
| --- | --- | --- |
| ZCode MCP | `npm test`；`npm run verify` | [ACCEPTANCE.md](../ACCEPTANCE.md)、[Flash/low 长等待](../long-wait-evidence.json)、[GLM/max 审查](../mcp-v3-evidence.json) |
| Codex CLI GLM / Responses API probe | Python compile、TOML/JSON 解析；`python -m unittest discover -s integrations/glm/test -p "test_*.py"`；认证助手只在本机明确调用 `--check` | [六组合、文件任务与原生入口失败](../integrations/glm/acceptance.json) |
| OpenCode GLM | `python -m unittest discover -s integrations/opencode/test -p "test_*.py"`、Python compile | [实际 model/effort 与两路并行](../integrations/opencode/acceptance/model-effort.json)、[主管接受的文件任务](../integrations/opencode/acceptance/file-task.json) |
| ZCode 内部 CLI | `node --test experiments/zcode-cli/test/*.test.cjs` | 无成功的真实模型证据；[失败与未验收范围](../experiments/zcode-cli/README.md) |

各模型/强度组合 API 成功不衡量推理质量。并发 probe 两路成功不证明任意规模的并发。时长属于具体任务，不应将不同任务直接当作性能排行榜。`supervisorAccepted` 与工具实际文件产物核验分开，不能只凭进程退出 0 接受任务。

OpenCode 真实六组合请求使用临时 127.0.0.1 转发服务，认证头仅在内存中传递到固定智谱官方 HTTPS 端点，留存实际模型、reasoning_effort、HTTP 状态和无私密数据的算术结果。不会保存原始请求、思考文本或 Key。显式复现 probe 会消耗账户配额，调用方法见 [OpenCode README](../integrations/opencode/README.md)；不加入默认离线检查。

文件任务原先两次权限匹配失败，均未记为成功；修正为 worktree 相对路径后，Flash/low 实际调用 read 和 write，主管核验 fixture 不变、输出 sum=89/count=3、真实会话 model/variant 正确。归档删除个人路径、会话 ID 与原始回报，保留失败原因及必要验收字段。

## 尚未验收

- GPT 主管原生跨 provider spawn GLM：当前指定版本已失败，没有成功替代证据。
- 当前聊天缓存旧 controller 的原生 MCP 入口恢复：标准 SDK 客户端成功不代表它已修复。
- ZCode 运行中原生子 agent TaskStop 取消、部分桌面中断后同进程重注册：协议覆盖不等于所有桌面端到端行为通过。
- OpenCode 更大规模并发、完整权限等价、净 token 节省、同任务性能对照：没有量化验收。
- GUI 自动调度器、hooks、定时唤醒：未实现，也未启用。

本次发布检查另见 [publication-checks.json](publication-checks.json)。该回执只陈述本次本地检查，不替代上述真实模型证据。
