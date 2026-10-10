# 多个 GLM 外部子智能体

OpenCode 路径可同时运行多个独立 `run-opencode.py` 进程，每个单独指定模型、强度、工作目录、任务文件、权限文件和新的结果目录。已有真实六组合 probe 每轮同时执行两个模型，证明两路并行可用；更多并发未验收，实际能力受账户限额、资源和任务大小影响。

并行阅读不同模块通常无需 worktree；并行修改应明确不同文件所有权，或准备独立 worktree。先完成实现并验收，再开始依赖这份实现的审查，不能把有依赖的阶段假装成独立任务。

## 一个可复制的进程等待示例

这是普通 Python 示例，不是新的常驻调度服务。替换所有 `<...>` 后保存到仓库外临时目录，任务本身应先准备完毕。结果目录每次必须是新的，权限文件各自精确限定。

```python
import subprocess
import sys
from pathlib import Path

runner = Path('<REPOSITORY>') / 'integrations/opencode/run-opencode.py'
jobs = [
    ('flash', 'low', '<WORKSPACE_A>', '<TASK_A>', '<PERMISSIONS_A>', '<NEW_RESULT_A>'),
    ('full', 'high', '<WORKSPACE_B>', '<TASK_B>', '<PERMISSIONS_B>', '<NEW_RESULT_B>'),
]
processes = []
try:
    for model, effort, workspace, task, permissions, result in jobs:
        processes.append(subprocess.Popen([
            sys.executable, str(runner), '--model', model, '--effort', effort,
            '--workspace', workspace, '--prompt-file', task,
            '--permissions-file', permissions, '--result-dir', result,
        ], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)))
finally:
    # Even if dispatching a later job fails, wait for already-started work.
    exit_codes = [process.wait() for process in processes]

if any(exit_codes):
    raise SystemExit('At least one worker failed; inspect its receipt before retrying.')
# CLI success is still pending independent supervisor acceptance.
```

示例没有 overall timeout、轮询或定时催问，也没有关闭共享服务。不要只启动进程后让主管提前结束；当前回合要保持到收到必要回报并验收。它未执行 worktree 合并、冲突处理、任务重放或自动审批。

ZCode MCP 也可按实际注册能力派发独立任务；仅注册一个 worker 不证明桌面所有并发档位可用。原生 profiles 必须真实载入且 provider/model/effort 精确匹配，不能静默降级。
