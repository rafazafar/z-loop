"""Claim one transcript, run the domain, and acknowledge verified output."""
import argparse
import datetime as dt
import fcntl
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from support import atomic, command, read_json, settings

ROOT = Path(__file__).resolve().parents[2]
HASH = re.compile(r"[0-9a-f]{64}")


def inventory(repo, directory):
    """Read stable local files, including files that are not committed."""
    folder = repo / directory
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError("transcript directory is unavailable or is a link")
    rows = []
    for file in folder.iterdir():
        name = file.name
        if file.suffix.lower() not in {".txt", ".md"} or name.lower() == "readme.md" or name.startswith(".") or re.search(r"[._-](tmp|partial|part)\.", name, re.I):
            continue
        match = re.search(r"(?<!\d)(\d{8})(?!\d)", file.stem)
        if any(c in name for c in "\t\n;\r") or file.is_symlink() or not file.is_file():
            raise ValueError("unsupported transcript name or file mode")
        before = file.stat()
        date = (dt.datetime.strptime(match[1], "%Y%m%d") if match else dt.datetime.fromtimestamp(before.st_mtime)).date().isoformat()
        data = file.read_bytes()
        after = file.stat()
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns) or time.time() - after.st_mtime < 10:
            continue  # A copy or editor save can still be in progress. Try next poll.
        if not data.decode("utf-8").strip() or b"\0" in data:
            raise ValueError("empty or invalid transcript")
        rows.append((date, name, hashlib.sha256(data).hexdigest(), f"{directory}/{name}", data))
    return sorted(rows)


def ledger_rows(state):
    path = state / "specsync.ledger"
    rows = {}
    if path.exists():
        for line in path.read_text().splitlines():
            key, status, name = line.split("\t")
            if not HASH.fullmatch(key) or status not in {"baseline", "completed", "blocked", "failed"}:
                raise ValueError("invalid transcript ledger")
            rows[key] = (status, name)
    return rows


def save_ledger(state, rows):
    atomic(state / "specsync.ledger", "".join(f"{key}\t{status}\t{name}\n" for key, (status, name) in sorted(rows.items())))


def recover(state, key, retry_round=0):
    cycles = [read_json(p) for p in (state / "cycles").glob("loop-spec-sync-*.json")]
    valid = [c for c in cycles if c.get("operation") == f"spec-sync:{key}" and c.get("state") == "terminal"
             and c.get("outcome") in {"PASS", "NOOP", "BLOCKED"}
             and c.get("retry_round", 0) == retry_round]
    return max(valid, key=lambda c: c["updated_at"]) if valid else None


def retry(state, rows, key, card_name):
    if not HASH.fullmatch(key) or rows.get(key, (None,))[0] not in {"blocked", "failed"}:
        raise ValueError("retry requires a blocked or failed transcript hash")
    card = (ROOT / card_name).resolve()
    if card.parent != ROOT / "decisions" or not card.is_file():
        raise ValueError("retry requires a decision card in decisions/")
    text = card.read_text()
    if not re.search(r"^status: decided$", text, re.M) or f"spec-sync:{key}" not in text:
        raise ValueError("card must be decided and cite the exact operation key")
    record = state / "specsync-retries" / f"{key}.json"
    history = read_json(record, [])
    attempts = int((state / "specsync-attempts" / key).read_text()) if (state / "specsync-attempts" / key).exists() else 0
    history.append({"requested_at": dt.datetime.now(dt.timezone.utc).isoformat(), "card": card_name, "attempt_offset": attempts, "applied": False})
    atomic(record, history)
    del rows[key]
    save_ledger(state, rows)
    history[-1]["applied"] = True
    atomic(record, history)
    print(f"retry queued: spec-sync:{key}")


def acknowledge(state, rows, key, name, cycle):
    if cycle["outcome"] == "BLOCKED":
        cards = [p for p in (ROOT / "decisions").glob("*.card.md") if f"spec-sync:{key}" in p.read_text()]
        if not cards or not cycle.get("artifacts"):
            raise ValueError("blocked cycle has no durable operation-linked decision card")
    rows[key] = ("blocked" if cycle["outcome"] == "BLOCKED" else "completed", name)
    save_ledger(state, rows)


def exhausted(state, rows, key, name, attempts, retries):
    suffix = f"-r{len(retries)}" if retries else ""
    card = ROOT / "decisions" / f"auto-specsync-blocked-{key[:12]}{suffix}.card.md"
    if not card.exists():
        atomic(card, f"""---
kind: card
status: open
domain: spec-sync
parked-by: runtime
date: {dt.date.today()}
---

# Retry this meeting transcript?

## Context

The transcript has {attempts} failed attempts.
Operation: spec-sync:{key}

## Option A — Retry

- What: Resolve the failure and run the explicit retry command.
- Better: Processing can continue.
- Worse: Another model run is required.

## Option B — Keep blocked

- What: Leave this transcript blocked.
- Better: No repeat model cost.
- Worse: Its changes remain pending.

## Evidence

- state/specsync-attempts/{key}

## Recommendation

A — Resolve the recorded failure before retry.

## Default if unanswered

B — Keep this transcript blocked.
""")
    if not re.search(r"^status: open$", card.read_text(), re.M) or f"spec-sync:{key}" not in card.read_text():
        raise ValueError("exhaustion card must be open and cite this operation")
    rows[key] = ("failed", name)
    save_ledger(state, rows)
    print("transcript blocked: attempts exhausted", file=sys.stderr)
    return 1


def run(args, state):
    config, spec, enabled, directory, max_attempts = settings(ROOT)
    rows = ledger_rows(state)
    if args.retry:
        retry(state, rows, args.retry, args.card or "")
        return 0
    if not enabled:
        print("spec-sync disabled in config")
        return 0
    active = re.search(r"^status: active$", (ROOT / "domains/spec-sync/README.md").read_text(), re.M)
    if not active and not args.manual:
        print("spec-sync paused")
        return 0
    # Finish a retry request interrupted between its journal and ledger writes.
    for record in (state / "specsync-retries").glob("*.json"):
        history = read_json(record)
        if history and history[-1].get("applied") is False:
            rows.pop(record.stem, None)
            save_ledger(state, rows)
            history[-1]["applied"] = True
            atomic(record, history)
    items = inventory(Path(config["project"]["repo_path"]), directory)
    atomic(state / "specsync.snapshot", "".join(f"{key}\t{name}\n" for _, name, key, _, _ in items))
    # Migrate only explicit old acknowledgments. Do not silently skip a new backlog.
    if not (state / "specsync.ledger").exists():
        seen = state / "specsync.seen"
        names = set(seen.read_text().splitlines()) if seen.exists() else set()
        rows.update({key: ("baseline", name) for _, name, key, _, _ in items if name in names})
        save_ledger(state, rows)
    items = [item for item in items if item[2] not in rows]
    if not items:
        print("no new transcripts")
        return 0
    base = config["github"]["base_branch"]
    command("git", "check-ref-format", f"refs/heads/{base}")
    remote = command("git", "remote", "get-url", "origin", cwd=config["project"]["repo_path"]).strip()
    # Fetch into a scratch repository. Never use or change the client's checkout.
    with tempfile.TemporaryDirectory(prefix="specsync-source-", dir=state) as temporary:
        source = Path(temporary)
        command("git", "init", "-q", str(source))
        command("git", "remote", "add", "origin", remote, cwd=source)
        command("git", "fetch", "-q", "origin", f"refs/heads/{base}", cwd=source)
        revision = command("git", "rev-parse", "FETCH_HEAD", cwd=source).strip()
        command("git", "checkout", "-q", "--detach", revision, cwd=source)
        for _, name, key, path, data in items:
            retries = read_json(state / "specsync-retries" / f"{key}.json", [])
            cycle = recover(state, key, len(retries))
            if cycle:
                acknowledge(state, rows, key, name, cycle)
                print(f"recovered {cycle['outcome']}: spec-sync:{key}")
                return 0
            attempt_file = state / "specsync-attempts" / key
            attempts = int(attempt_file.read_text()) if attempt_file.exists() else 0
            offset = retries[-1]["attempt_offset"] if retries else 0
            if attempts - offset >= max_attempts:
                return exhausted(state, rows, key, name, attempts, retries)
            base_revision = revision
            destination = source / path
            if destination.is_symlink() or any(p.is_symlink() for p in destination.parents if p != source.parent):
                raise ValueError("source transcript path contains a link")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            command("git", "add", "--", path, cwd=source)
            if command("git", "diff", "--cached", "--name-only", cwd=source).strip():
                command("git", "-c", "user.name=Transcript runtime", "-c", "user.email=transcript@localhost",
                        "commit", "-q", "--no-gpg-sign", "--no-verify", "-m", "docs: record meeting transcript", cwd=source)
                revision = command("git", "rev-parse", "HEAD", cwd=source).strip()
            # An orphan domain may still read its claim after the trigger dies.
            # Never replace another attempt's source or retry context.
            claim = state / "specsync-claims" / f"{key}-{uuid.uuid4().hex}.json"
            failed = [read_json(p) for p in (state / "cycles").glob("loop-spec-sync-*.json")]
            failed = [c for c in failed if c.get("operation") == f"spec-sync:{key}" and c.get("outcome") == "FAIL"]
            previous = max(failed, key=lambda c: c["updated_at"]) if failed else None
            previous_failure = None
            if previous:
                verdict = Path(os.environ.get("KOKOLOG_SESSIONS", state / "sessions")) / f"{previous.get('verifier_session', '')}.result"
                previous_failure = {"cycle": previous["id"], "summary": previous["summary"],
                                    "verdict": str(verdict) if verdict.exists() else None}
            atomic(claim, {"hash": key, "name": name, "path": path, "revision": revision, "base": base,
                           "base_revision": base_revision,
                           "retry_round": len(retries),
                           "previous_failure": previous_failure,
                           "source": str(source), "manual": args.manual, "retry_card": retries[-1]["card"] if retries else None})
            env = dict(os.environ, SPEC_SYNC_CLAIM=str(claim))
            # A terminated attempt still counts. The terminal cycle can repair its acknowledgment.
            atomic(attempt_file, f"{attempts + 1}\n")
            result = subprocess.run([str(ROOT / "run/domain-loop"), "spec-sync", f"operation: spec-sync:{key}"], env=env)
            if result.returncode == 75:
                atomic(attempt_file, f"{attempts}\n")
                return 0
            cycle = recover(state, key, len(retries))
            if result.returncode == 0 and cycle:
                acknowledge(state, rows, key, name, cycle)
                return 0
            return result.returncode or 1
    print("no new transcripts")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Meeting Notes → Draft Spec PR")
    parser.add_argument("--manual", action="store_true", help="run once while paused; never load the timer")
    parser.add_argument("--retry", metavar="SHA256", help="queue an authorized retry; do not run an actor")
    parser.add_argument("--card", help="decided card path relative to the loop repository")
    args = parser.parse_args()
    state = Path(os.environ.get("KOKOLOG_STATE", ROOT / "state")).resolve()
    state.mkdir(parents=True, exist_ok=True)
    # Keep this inode. flock releases on exit or crash; no stale PID repair.
    with (state / "specsync.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another transcript trigger holds the claim lock")
            return 0
        return run(args, state)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
