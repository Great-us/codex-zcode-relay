# 配置维护与升级检查

正常调用不需要每次重新配置。“维护”指依赖升级、接口变化或认证更新时核验现有路径仍有效。

| 路径 | 需要核验的变化 | 可用检查 |
| --- | --- | --- |
| OpenCode | CLI flags、JSON 事件、provider/model/variant、权限路径匹配、已保存认证 | CLI help、离线检查；明确允许消耗配额时运行六组合 probe 并另做真实文件任务 |
| Codex CLI GLM | provider/auth 配置、Responses API、profile、模型目录、CLI flags、ZCode Key 源结构 | 认证助手仅运行 `--check`；离线语法检查；有授权时复核模型与文件任务 |
| ZCode MCP | Node/SDK、安装路径、profiles 实际载入、bridgeVersion、两端连接与接收循环 | `npm test`、`npm run verify`，再完成真实桌面任务 |
| 内部 CLI 归档 | 特定 ZCode bundle 哈希、内部协议与独立 OAuth | hash guard 不可绕过；协议单元测试不证明模型接入成功 |

升级改变了接口或模型，应重新核验实际请求的模型和思考强度，不能用模型自述、磁盘配置或 UI 显示代替。OpenCode 自身管理智谱 provider 接入，我们自写的适配部分较少，但仍有版本绑定的权限路径处理。

直连 Codex GLM 的认证命令按需使用 ZCode 已保存 Key；原始 ZCode config 不应复制到仓库。OpenCode 复用其本机认证，也不应提交 auth.json。Key 删除、失效或换源时，执行器会失败，应调整本机配置或读取逻辑；不能把 Key 发到聊天或任务中作为“修复”。

MCP 源码更新后，已有进程需实际加载新版一次，检查工具返回的 bridgeVersion。普通明确注册恢复与源码升级不同：前者已由 0.3 支持，后者不保证自动热更新。新聊天仍应核验连接，不能从磁盘已更新推断当前工具已恢复。

安装器默认拒绝覆盖不同内容。版本更新时先确认改动与备份，再明确替换；本仓库的全局规则模板须合并，不覆盖用户其它协作偏好。克隆或更新代码不自动启动模型、安装 MCP 或修改账户设置。
