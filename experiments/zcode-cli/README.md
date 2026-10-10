# ZCode 内部 CLI 历史实验（未完成真实模型验收）

这条早期路线尝试把本机 ZCode 0.16.9 内部 CLI 引擎包装成 MCP，以独立执行模型任务。BigModel 浏览器授权后出现“跳转失败，请返回应用重试”；独立 CLI 登录没有完成验收，桌面登录也不能代替这项事实。此目录不是推荐的生产执行器。

## 保留的自写源码

- `native-bundle.cjs`：只读取用户已安装的特定 ZCode bundle，验证精确哈希后在内存中适配内部入口；不修改安装文件，版本不同直接失败。
- `native-runner.cjs`：独立 CLI login、diagnose 和协议 worker 入口。login 依赖官方 OAuth，不输出 token；本项目没有证明该流程可用。
- `protocol.cjs`：请求关联、推送事件、隐藏子进程启动、错误和敏感诊断过滤。
- `controller.cjs`：任务派发、模型/effort 可用性检查、事件等待、取消请求和任务客户端关闭。协议结果不等于真实模型运行证明。
- `server.cjs`：历史 MCP 适配；为避免与生产中继混淆，默认拒绝启动，只有明确设置 `ZCODE_ENABLE_LEGACY_EXPERIMENT=1` 才可研究。
- `test/`：假的协议／客户端回归检查，完全不调用 ZCode 或模型。临时数据只位于仓库被忽略的 `runtime/test/legacy-controller/` 专属目录。

厂商 bundle、state/account、OAuth 信息、个人配置、运行日志和含本机绝对路径的调试包装脚本没有归档。测试所需 Node.js 与 SDK 使用仓库根依赖；server 的 SDK 入口指向仓库 `sdk.cjs`。

```sh
node --test experiments/zcode-cli/test/*.test.cjs
```

以上检查只证明适配器中的协议逻辑。本次发布不重试 OAuth、不自动启动 server、不绕过 bundle hash guard，也不宣称支持任意 ZCode 版本。该协议测试不能替代真实账户、模型、强度、工具与完成回报验收。

如果以后重新研究，在独立本机状态目录内进行，明确允许根、工具范围、登录和网络授权。该内部适配不具备主管的 OS 沙箱，不自动审批请求；任务 journal 可能含私有结果，应保持忽略。历史 server tool 名称与生产 controller 相似，但语义不同，不能同时冒充同一接入。

可用替代路径见 [全部路线](../../docs/routes.md)：OpenCode、Codex CLI GLM 直连，以及已登录 ZCode 桌面的 MCP worker 中继。
