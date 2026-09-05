"""Bind the claim to Git and build independent, revision-specific PR evidence."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from support import atomic, command, read_json, settings

ROOT = Path(__file__).resolve().parents[2]


def claim():
    value = read_json(os.environ["SPEC_SYNC_CLAIM"])
    if not re.fullmatch(r"[0-9a-f]{64}", value["hash"]) or not re.fullmatch(r"[0-9a-f]{40,64}", value["revision"]):
        raise ValueError("invalid transcript claim")
    if Path(value["path"]).is_absolute() or ".." in Path(value["path"]).parts:
        raise ValueError("invalid claimed path")
    return value


def verify_source(repo, value):
    data = command("git", "show", f"{value['revision']}:{value['path']}", cwd=repo).encode("utf-8")
    if hashlib.sha256(data).hexdigest() != value["hash"]:
        raise ValueError("claimed transcript hash does not match the source revision")


def matching_prs(repo, key):
    repository = json.loads(command("gh", "repo", "view", "--json", "nameWithOwner", cwd=repo))["nameWithOwner"]
    pages = json.loads(command("gh", "api", "--paginate", "--slurp", f"repos/{repository}/pulls?state=all&per_page=100", cwd=repo))
    marker = re.compile(r"(?<![\w:-])" + re.escape(key) + r"(?![\w:-])")
    matches = [pr for page in pages for pr in page if marker.search(pr.get("body") or "")]
    if len(matches) > 1:
        raise ValueError("multiple PRs contain this operation key; resolve the duplicate PRs")
    return matches


def prepare(repo, operation):
    value = claim()
    if operation != f"spec-sync:{value['hash']}":
        raise ValueError("operation key differs from the claim")
    _, _, enabled, _, _ = settings(ROOT)
    if not enabled:
        raise ValueError("spec-sync is disabled")
    command("git", "clone", "-q", "--no-local", value["source"], str(repo))
    remote = command("git", "remote", "get-url", "origin", cwd=value["source"]).strip()
    command("git", "remote", "set-url", "origin", remote, cwd=repo)
    command("git", "checkout", "-q", "-b", f"zafar/spec-sync-{value['hash']}", value["revision"], cwd=repo)
    verify_source(repo, value)
    # Supply known PRs before the actor can publish. Include closed and merged PRs.
    prs = matching_prs(repo, operation)
    if prs and prs[0]["state"] == "open":
        pr = prs[0]
        if not pr["draft"] or pr["base"]["ref"] != value["base"]:
            raise ValueError("existing PR must be a draft on the configured base")
        command("git", "fetch", "-q", "origin", f"refs/pull/{pr['number']}/head", cwd=repo)
        head = command("git", "rev-parse", "FETCH_HEAD", cwd=repo).strip()
        if head != pr["head"]["sha"]:
            raise ValueError("existing PR changed during reconciliation")
        verify_source(repo, dict(value, revision=head))
        command("git", "checkout", "-q", "-B", pr["head"]["ref"], head, cwd=repo)
    atomic(Path(os.environ["SPEC_SYNC_CLAIM"]).with_suffix(".prs.json"), [metadata(pr) for pr in prs])


def metadata(pr):
    return {"number": pr["number"], "state": pr["state"], "draft": pr["draft"], "merged_at": pr["merged_at"],
            "base": pr["base"]["ref"], "base_sha": pr["base"]["sha"], "head_sha": pr["head"]["sha"],
            "body": pr.get("body") or ""}


def copy_source(repo, revision, target):
    """Copy tracked regular files. Do not expose links or the clone's Git config."""
    command("git", "checkout", "-q", "--detach", revision, cwd=repo)
    target.mkdir(parents=True, exist_ok=True)
    for entry in command("git", "ls-tree", "-rz", revision, cwd=repo).split("\0"):
        if not entry:
            continue
        mode, path = entry.split("\t", 1)
        if mode.split()[0] not in {"100644", "100755"}:
            continue
        destination = target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / path, destination)


def collect(repo, target, actor_result, stage):
    value = claim()
    operation = f"spec-sync:{value['hash']}"
    outcome = re.search(r"^OUTCOME: (\w+)$", actor_result.read_text(), re.M)[1]
    verify_source(repo, value)
    if command("git", "status", "--porcelain", cwd=repo).strip():
        raise ValueError("actor left uncommitted or untracked files")
    prs = matching_prs(repo, operation)
    if outcome == "PASS" and not prs:
        raise ValueError("PASS requires one operation-linked draft PR")
    current = value["revision"]
    proof = {"operation": operation, "source_revision": value["revision"], "outcome": outcome, "pr": None}
    if prs:
        pr = prs[0]
        meta = metadata(pr)
        if meta["base"] != value["base"]:
            raise ValueError("PR targets the wrong base")
        if pr["head"]["repo"] is None or pr["head"]["repo"]["id"] != pr["base"]["repo"]["id"]:
            raise ValueError("PR must use a branch in the client repository")
        if outcome == "PASS" and (meta["state"] != "open" or not meta["draft"]):
            raise ValueError("PASS requires an open draft PR")
        if outcome == "NOOP" and not meta["merged_at"]:
            raise ValueError("an unmerged PR cannot be acknowledged as NOOP")
        if meta["state"] == "open" and not meta["draft"]:
            raise ValueError("transcript PR must remain a draft")
        command("git", "fetch", "-q", "origin", f"refs/pull/{pr['number']}/head", cwd=repo)
        current = command("git", "rev-parse", "FETCH_HEAD", cwd=repo).strip()
        if current != meta["head_sha"]:
            raise ValueError("PR head changed during evidence capture")
        command("git", "fetch", "-q", "origin", meta["base_sha"], cwd=repo)
        merge_base = command("git", "merge-base", meta["base_sha"], current, cwd=repo).strip()
        changes = command("git", "diff", "--name-only", "-z", merge_base, current, cwd=repo).split("\0")
        paths = [p for p in changes if p]
        if not paths or any(not p.startswith("docs/") or not p.lower().endswith((".md", ".txt"))
                            or (p.startswith(value["path"].rsplit("/", 1)[0] + "/") and p != value["path"]) for p in paths):
            raise ValueError("PR must change documentation and the selected transcript only")
        verify_source(repo, dict(value, revision=current))
        for path in paths:
            mode = command("git", "ls-tree", current, "--", path, cwd=repo).split()
            if mode and mode[0] not in {"100644", "100755"}:
                raise ValueError("document changes must not introduce links or submodules")
        atomic(target / "pr.diff", command("git", "diff", "--no-ext-diff", merge_base, current, cwd=repo))
        atomic(target / "pr.json", meta)
        # Capture exact-head checks. Pending or absent checks remain visible.
        checks = json.loads(command("gh", "pr", "view", str(pr["number"]), "--json", "headRefOid,statusCheckRollup", cwd=repo))
        if checks["headRefOid"] != current:
            raise ValueError("check evidence belongs to another PR head")
        atomic(target / "checks.json", checks)
        proof["pr"] = {"number": pr["number"], "head": current, "base": meta["base_sha"], "paths": paths}
    else:
        atomic(target / "pr.diff", "No operation-linked PR exists.\n")
        atomic(target / "checks.json", {"status": "not-applicable", "reason": "No PR exists"})
    command("git", "diff", "--check", value["revision"], current, cwd=repo)
    proof["diff_check_exit"] = 0
    copy_source(repo, current, target / "source")
    source_data = command("git", "show", f"{value['revision']}:{value['path']}", cwd=repo)
    atomic(target / "transcript.txt", source_data)
    atomic(target / "claim.json", {k: value[k] for k in ("hash", "name", "path", "revision", "base")})
    shutil.copyfile(ROOT / "AGENTS.md", target / "loop-instructions.md")
    shutil.copyfile(ROOT / "domains/spec-sync/README.md", target / "contract.md")
    shutil.copyfile(actor_result, target / "actor.result")
    shutil.copytree(stage, target / "staging", dirs_exist_ok=True)
    atomic(target / "runtime.json", proof)


def recheck(repo, target):
    """Do not acknowledge a PR that changed while the verifier was reading."""
    proof = read_json(target / "runtime.json")
    prs = matching_prs(repo, proof["operation"])
    old = read_json(target / "pr.json")
    new = metadata(prs[0]) if prs else None
    if new != old:
        raise ValueError("PR changed during independent verification")


if __name__ == "__main__":
    try:
        action, *args = sys.argv[1:]
        if action == "prepare":
            prepare(Path(args[0]), args[1])
        elif action == "collect":
            collect(*(Path(arg) for arg in args))
        elif action == "recheck":
            recheck(*(Path(arg) for arg in args))
        else:
            raise ValueError("unknown evidence action")
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
