"""短示例：并行启动两个独立的 OpenCode GLM 任务。

前置：先把下面尖括号占位符替换为实际值。
每个任务使用独立结果目录与独立权限文件；更大规模并行未经验收，不建议超过两路。
"""
import json
import os
import subprocess
import sys
from pathlib import Path

RUNNER = "<RUNNER_PY>"
JOBS = [
    {"workspace": "<WORKSPACE_A>", "task": "<TASK_A>", "result_dir": "<RESULT_DIR_A>", "permissions": "<PERMISSIONS_A>", "model": "flash", "effort": "low"},
    {"workspace": "<WORKSPACE_B>", "task": "<TASK_B>", "result_dir": "<RESULT_DIR_B>", "permissions": "<PERMISSIONS_B>", "model": "full", "effort": "high"},
]


def validate_before_launch():
    """所有占位符必须已替换、各路径已给出、结果目录互异；
    全部通过后才允许启动第一个进程。"""
    values = [RUNNER] + [value for job in JOBS for value in job.values()]
    if any(not value or "<" in value or ">" in value for value in values):
        raise SystemExit("请先替换脚本中的全部 <...> 占位符再运行。")
    result_dirs = [os.path.normcase(str(Path(job["result_dir"]).resolve())) for job in JOBS]
    if len(set(result_dirs)) != len(result_dirs):
        raise SystemExit("各任务的结果目录必须互不相同。")


def launch(job):
    return subprocess.Popen([
        sys.executable, RUNNER,
        "--model", job["model"], "--effort", job["effort"],
        "--workspace", job["workspace"], "--prompt-file", job["task"],
        "--result-dir", job["result_dir"], "--permissions-file", job["permissions"],
    ], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def main():
    validate_before_launch()
    processes = []
    failed = False
    try:
        for job in JOBS:
            try:
                processes.append((job, launch(job)))
            except Exception as error:
                failed = True
                print(json.dumps({"result_dir": job["result_dir"], "launchError": type(error).__name__}, ensure_ascii=False))
                break
    finally:
        for job, process in processes:
            exit_code = process.wait()  # 无任务总时限；不用未及时排空的 PIPE 阻塞其它进程。
            try:
                receipt = json.loads((Path(job["result_dir"]) / "receipt.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                receipt = {}
            completed = exit_code == 0 and isinstance(receipt, dict) and receipt.get("executionCompleted") is True
            failed = failed or not completed
            print(json.dumps({"result_dir": job["result_dir"], "returncode": exit_code,
                              "executionCompleted": bool(completed), "supervisorAccepted": False}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
