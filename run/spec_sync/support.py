"""Runtime helpers for transcript jobs."""
import json
import os
import subprocess
import tempfile
from pathlib import Path


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def read_json(path, default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default


def command(*args, cwd=None):
    result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=120)
    if result.returncode:
        # Do not persist remote addresses or authentication diagnostics.
        raise ValueError(f"{args[0]} {args[1]} failed (exit {result.returncode})")
    return result.stdout.decode("utf-8")


def settings(root):
    config = read_json(root / "config.json")
    spec = config.get("domains", {}).get("spec_sync", {})
    enabled = spec.get("enabled", True)
    if type(enabled) is not bool:
        raise ValueError("domains.spec_sync.enabled must be boolean")
    path = spec.get("transcripts_path", "docs/meeting-transcripts")
    if not isinstance(path, str) or not path or Path(path).is_absolute() or ".." in Path(path).parts:
        raise ValueError("transcripts_path must be a repository-relative directory")
    attempts = spec.get("max_attempts", 3)
    if type(attempts) is not int or attempts < 1:
        raise ValueError("spec_sync.max_attempts must be a positive integer")
    return config, spec, enabled, path, attempts
