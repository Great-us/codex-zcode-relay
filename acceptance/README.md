# 重复真实长等待测试

`long-wait-fixture.cjs` 是本次验收使用的原始 helper，SHA-256 与脱敏验收记录一致。它执行一次 150 秒定时器、计算 `19 * 19`，向同目录 `long-wait-result.json` 写开始和完成时间；结果文件已排除 Git。

先启动两端 MCP 和 ZCode 路由器，确认真实模型及 profile 在线。主管通过 `zcode_spawn` 派发给 `GLM-5.3-Flash / low`，给出 helper 的本机绝对路径，允许子智能体仅执行该 helper 并读写其结果文件，禁止访问凭据、其它项目或联网。

任务要求：只运行 helper 一次，使用至少 240,000 ms 的命令超时；等待实际结束，核验 `state:completed`、`elapsedMs >= 150000`、`calculation:361`，再通过 `report_result` 回报。不可修改或缩短 helper 的延迟，不可提前回报完成。

主管持续保持回合，用 `zcode_wait(taskIds, timeoutMs:55000)` 接收事件，每次 `timedOut` 后继续等待同一任务。至少经历两个完整超时再收到真实完成回报。等待之间可推进独立工作。

最终独立核验产物、脚本哈希、实际模型请求及 taskId 到原生 Agent 的关联。使用者本机的日志只能提取允许的模型、effort 和关联字段，禁止上传原始请求、headers、lease 或认证状态。
