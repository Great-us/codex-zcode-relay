"""Install credential-free GLM provider and standalone Codex profiles."""
import hashlib
import json
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path

source = Path(__file__).resolve().parent
home = Path.home() / ".codex"
target = home / "glm-integration"
config_path = home / "config.toml"
original = config_path.read_bytes()
config = tomllib.loads(original.decode("utf-8"))
provider_text = (source / "provider.toml").read_text(encoding="utf-8")
for marker, value in [("@PYTHON_EXECUTABLE@", sys.executable), ("@GLM_AUTH_HELPER@", str(target / "read-zcode-key.py"))]:
    provider_text = provider_text.replace('"' + marker + '"', json.dumps(value))
provider = tomllib.loads(provider_text)["model_providers"]["zhipu_glm"]
existing = config.get("model_providers", {}).get("zhipu_glm")
if existing is not None and existing != provider:
    raise RuntimeError("Existing zhipu_glm provider differs; refusing to overwrite it")
files = [(target / name, (source / name).read_bytes()) for name in ["read-zcode-key.py", "glm-models.json"]]
for profile in (source / "profiles").glob("*.toml"):
    text = profile.read_text(encoding="utf-8").replace('"@GLM_MODEL_CATALOG@"', json.dumps(str(target / "glm-models.json")))
    tomllib.loads(text)
    files.append((home / profile.name, text.encode("utf-8")))
for dst, content in files:
    if dst.exists() and dst.read_bytes() != content:
        raise RuntimeError(f"Existing file differs; refusing to overwrite: {dst.name}")
updated = original.decode("utf-8")
if existing is None:
    updated = updated.rstrip() + "\n\n# GLM Coding Plan: auth reuses the user's local ZCode API key.\n" + provider_text
parsed = tomllib.loads(updated)
for field in ["model", "model_provider", "model_reasoning_effort"]:
    if parsed.get(field) != config.get(field):
        raise RuntimeError("Default supervisor settings changed unexpectedly")
backup = home / "backups" / ("glm-direct-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
backup.mkdir(parents=True, exist_ok=False)
(backup / "config.toml").write_bytes(original)
for dst, content in files:
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(content)
config_path.write_text(updated, encoding="utf-8", newline="\n")
receipt = {
    "installed_at": datetime.now(timezone.utc).isoformat(),
    "supervisor_model": parsed.get("model"),
    "supervisor_provider": parsed.get("model_provider"),
    "supervisor_effort": parsed.get("model_reasoning_effort"),
    "glm_provider": "zhipu_glm",
    "glm_endpoint": provider["base_url"],
    "profiles": [p.name for p in (source / "profiles").glob("*.toml")],
    "native_cross_provider_supported": False,
    "execution_mode": "independent Codex GLM process",
    "runner_sandbox": "workspace-write/windows-unelevated",
    "runner_overall_timeout_seconds": None,
    "key_copied": False,
    "global_catalog_enabled": bool(parsed.get("model_catalog_json")),
    "config_before_sha256": hashlib.sha256(original).hexdigest(),
    "config_after_sha256": hashlib.sha256(updated.encode()).hexdigest(),
    "backup": str(backup),
}
(source / "installation.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k:v for k,v in receipt.items() if k != "backup"}, ensure_ascii=False))
