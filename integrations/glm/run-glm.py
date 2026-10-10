"""Run one independent GLM Codex task and wait for its actual process completion."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--model", choices=["flash", "full"], default="flash")
parser.add_argument("--effort", choices=["low", "high", "max"], default="low")
parser.add_argument("--workspace", type=Path, required=True)
parser.add_argument("--prompt-file", type=Path, required=True)
args = parser.parse_args()
workspace = args.workspace.resolve(strict=True)
if not workspace.is_dir():
    parser.error("The workspace must be a directory")
prompt = args.prompt_file.resolve(strict=True).read_text(encoding="utf-8-sig")
if not prompt.strip():
    parser.error("The prompt file must contain a task")
home = Path.home() / ".codex"
helper = home / "glm-integration/read-zcode-key.py"
profile = "glm-" + args.model + "-" + args.effort
if not helper.is_file() or not (home / (profile + ".config.toml")).is_file():
    parser.error("Run install-glm.py first")
provider_text = (Path(__file__).resolve().parent / "provider.toml").read_text(encoding="utf-8")
for marker, value in [("@PYTHON_EXECUTABLE@", sys.executable), ("@GLM_AUTH_HELPER@", str(helper))]:
    provider_text = provider_text.replace('"' + marker + '"', json.dumps(value))
provider = tomllib.loads(provider_text)["model_providers"]["zhipu_glm"]

def toml_value(value):
    if isinstance(value, dict):
        return "{" + ", ".join(json.dumps(k) + "=" + toml_value(v) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(toml_value(v) for v in value) + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    return json.dumps(value)

codex = shutil.which("codex")
if not codex:
    candidate = Path.home() / "AppData/Local/Programs/OpenAI/Codex/bin/codex.exe"
    if candidate.is_file():
        codex = str(candidate)
if not codex:
    parser.error("Codex CLI was not found")
command = [codex, "--no-daemon", "--ask-for-approval", "never", "exec", "--profile", profile,
           "--ignore-user-config", "--strict-config", "--ephemeral", "--skip-git-repo-check",
           "--sandbox", "workspace-write", "--json", "--cd", str(workspace),
           "-c", "model_providers.zhipu_glm=" + toml_value(provider),
           "-c", 'windows.sandbox="unelevated"',
           "-c", "projects." + toml_value(str(workspace)) + '.trust_level="trusted"',
           "--disable", "computer_use", "-c", 'web_search="disabled"',
           "-c", 'model_reasoning_summary="none"', "--", prompt]
environment = os.environ.copy()
environment.pop("CODEX_MCP_NODE_PATH", None)
# No overall task timeout. The supervisor must keep waiting on the process,
# then independently inspect artifacts; a zero exit code is not acceptance.
raise SystemExit(subprocess.run(command, cwd=workspace, env=environment, stdin=subprocess.DEVNULL).returncode)
