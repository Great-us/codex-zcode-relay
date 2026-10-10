"""Codex command-backed authentication for the user's existing GLM Coding Plan key.

No credentials are copied into this file. Standard output is the credential
channel when Codex invokes the helper; --check never prints the key.
"""
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit


def read_key():
    config = json.loads(
        (Path.home() / ".zcode" / "v2" / "config.json").read_text(encoding="utf-8")
    )
    provider = config["provider"]["builtin:bigmodel-coding-plan"]
    options = provider["options"]
    if urlsplit(options.get("baseURL", "")).hostname != "open.bigmodel.cn":
        raise ValueError("The Coding Plan key source is not the expected BigModel provider")
    key = options.get("apiKey", "")
    if not isinstance(key, str) or len(key) < 20 or any(c.isspace() for c in key):
        raise ValueError("A usable local Coding Plan API key was not found")
    if set(key) <= set("*.•") or key.lower() in {"your_api_key", "your-api-key"}:
        raise ValueError("The local Coding Plan key is a placeholder")
    return key


if __name__ == "__main__":
    try:
        credential = read_key()
        if sys.argv[1:] == ["--check"]:
            print(json.dumps({"key_present": True, "source": "ZCode Coding Plan"}))
        elif sys.argv[1:]:
            raise ValueError("Unknown argument")
        else:
            sys.stdout.write(credential + "\n")
    except Exception:
        print("GLM authentication: the local Coding Plan key could not be loaded.", file=sys.stderr)
        sys.exit(1)
