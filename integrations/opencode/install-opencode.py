"""Install the OpenCode GLM runner and README into a tools directory.

Default target is ~/.codex/tools/opencode-glm. Preflights every file before
writing anything, so a conflict never leaves a partial install. Identical
content is idempotent; differing content is refused unless --force.
Credentials and model configuration are never touched.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent
FILES = ("run-opencode.py", "README.md")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Install OpenCode GLM integration files")
    parser.add_argument("--target", type=Path, default=Path.home() / ".codex" / "tools" / "opencode-glm")
    parser.add_argument("--force", action="store_true", help="overwrite files whose content differs")
    args = parser.parse_args()
    target = args.target.resolve()
    sources = {name: SOURCE_DIR / name for name in FILES}
    for name, source in sources.items():
        if not source.is_file():
            parser.error(f"missing source file: {source}")
    # Full preflight before any write to avoid partial installs.
    conflicts = []
    for name in FILES:
        destination = target / name
        if destination.exists() and digest(destination) != digest(sources[name]):
            conflicts.append(name)
    if conflicts and not args.force:
        parser.error("refusing to overwrite differing files: " + ", ".join(conflicts) + " (use --force)")
    target.mkdir(parents=True, exist_ok=True)
    installed, unchanged = [], []
    for name in FILES:
        destination = target / name
        if destination.exists() and digest(destination) == digest(sources[name]):
            unchanged.append(name)
            continue
        destination.write_bytes(sources[name].read_bytes())
        installed.append(name)
    print(json.dumps({"target": str(target), "installed": installed, "unchanged": unchanged, "forced": bool(conflicts) and args.force}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
