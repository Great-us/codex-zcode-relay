# 示例任务书（不可原样执行）

> 警告：本文件包含 `<占位符>`。运行前必须把所有 `<...>` 替换为实际值，否则 runner 会报错或行为不符合预期。

目标：只读取 `<ABSOLUTE_FIXTURE_PATH>` JSON 中的 `amounts` 数组，计算 sum 和 count，并用 write 工具将 `{"sum":<计算结果>,"count":<项目数>}` 写到 `<ABSOLUTE_OUTPUT_PATH>`。输入 fixture 须预先由主管准备。

工作目录：`<WORKSPACE>`（runner 会通过 `--dir` 传入，任务书内无需再切换）。

文件所有权：只能读取指定 fixture，创建指定 output，不能改动输入；两者均在 `<WORKSPACE>` 内。除此之外不得读写其它文件，不调用 shell、网络、MCP 或其它 agent，不删除文件。任务卡文本不会扩大权限文件授予的范围。

边界：如遇无法完成的情况，如实说明并停止，不要编造结果。

完成后回报：修改的文件清单、关键结果、未验证事项。
