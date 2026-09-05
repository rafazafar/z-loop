"""Exercise real Git and the domain shell with fake model and GitHub boundaries."""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "run/spec_sync"))
import evidence


def run(*args, cwd=None, env=None):
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True)


FAKE_GH = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
data = json.loads((Path(os.environ['FIXTURE_ROOT']) / 'pr.json').read_text())
if sys.argv[1:3] == ['repo', 'view']:
    print(json.dumps({'nameWithOwner':'fixture/project'}))
elif sys.argv[1] == 'api':
    print(json.dumps([data]))
elif sys.argv[1:3] == ['pr', 'view']:
    print(json.dumps({'headRefOid':data[0]['head']['sha'], 'statusCheckRollup':[]}))
else:
    sys.exit(2)
'''

FAKE_SPAWN = '''#!/usr/bin/env python3
import datetime, json, os, re, subprocess, sys
from pathlib import Path
root = Path(os.environ['FIXTURE_ROOT'])
if sys.argv[1] != 'start':
    sys.exit(0)
sid, model, variant, workdir, prompt = sys.argv[2:]
workdir = Path(workdir)
state = Path(os.environ['KOKOLOG_STATE'])
sessions = state / 'sessions'
claim = json.loads(Path(os.environ['SPEC_SYNC_CLAIM']).read_text())
key = 'spec-sync:' + claim['hash']
mode = os.environ.get('FIXTURE_MODE', 'NOOP')
def git(*args, cwd=workdir):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()
if sid.endswith('-verify'):
    (root / 'verifier-workdir').write_text(str(workdir))
    assert (workdir / 'runtime.json').is_file()
    verdict = 'FAIL' if mode == 'VERIFY_FAIL' else 'PASS'
    refs = 'runtime.json, transcript.txt, pr.diff, checks.json' if mode != 'MISSING_EVIDENCE' else 'none'
    if mode == 'MUTATE_PR':
        changed = json.loads((root / 'pr.json').read_text())
        changed[0]['draft'] = False
        (root / 'pr.json').write_text(json.dumps(changed))
    result = f'VERDICT: {verdict}\\nACTOR: {sid[:-7]}\\nSUMMARY: Fixture verifier result.\\nEVIDENCE: {refs}\\n'
else:
    calls = root / 'actor-calls'
    calls.write_text(calls.read_text() + sid + '\\n' if calls.exists() else sid + '\\n')
    outcome = 'PASS' if mode in ('PASS','VERIFY_FAIL','WRONG_BASE','NOT_DRAFT','CODE_CHANGE','MISSING_EVIDENCE','REUSE','MUTATE_PR') else mode
    artifacts = 'none'
    if mode == 'REUSE':
        assert claim['previous_failure']['verdict']
        artifacts = 'PR 1'
    elif outcome == 'PASS':
        docs = workdir / ('app.py' if mode == 'CODE_CHANGE' else 'docs/spec.md')
        docs.write_text('Updated from the selected transcript.\\n')
        git('add','--',str(docs))
        git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-qm','docs: update fixture spec')
        head = git('rev-parse','HEAD')
        git('push','-q','--force','origin','HEAD:refs/pull/1/head')
        pr = {'number':1,'state':'open','draft':mode != 'NOT_DRAFT','merged_at':None,'body':key,
              'base':{'ref':'wrong' if mode == 'WRONG_BASE' else 'main','sha':claim['base_revision'],'repo':{'id':1}},
              'head':{'sha':head,'ref':'zafar/spec-sync-' + claim['hash'],'repo':{'id':1}}}
        (root / 'pr.json').write_text(json.dumps([pr]))
        artifacts = 'PR 1'
    elif outcome == 'BLOCKED':
        card = state / 'staging' / sid / 'decisions' / 'fixture.card.md'
        card.write_text('---\\nkind: card\\nstatus: open\\ndomain: spec-sync\\n---\\nOperation: ' + key + '\\n')
        artifacts = 'decisions/fixture.card.md'
    elif outcome == 'FAIL':
        pass
    else:
        outcome = 'NOOP'
    result = f'OUTCOME: {outcome}\\nSUMMARY: Fixture actor result.\\nWORK_UNIT: {claim["path"]}\\nOPERATION: {key}\\nARTIFACTS: {artifacts}\\n'
(sessions / (sid + '.result')).write_text(result)
(sessions / (sid + '.exit')).write_text('0\\n')
(sessions / (sid + '.done')).touch()
'''


class TranscriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.state = self.root / "state"
        self.state.mkdir()
        (self.root / "run").mkdir()
        for name in ("common.sh", "domain-loop", "spec-sync-trigger", "spawn-exec"):
            shutil.copy(ROOT / "run" / name, self.root / "run" / name)
        shutil.copytree(ROOT / "run/spec_sync", self.root / "run/spec_sync", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "agents", self.root / "agents")
        (self.root / "domains/spec-sync").mkdir(parents=True)
        shutil.copy(ROOT / "domains/spec-sync/README.md", self.root / "domains/spec-sync/README.md")
        shutil.copy(ROOT / "AGENTS.md", self.root / "AGENTS.md")
        (self.root / "decisions").mkdir()
        self.remote = self.root / "remote.git"
        self.client = self.root / "client"
        self.must("git", "init", "--bare", "-q", str(self.remote))
        self.must("git", "init", "-q", "-b", "main", str(self.client))
        (self.client / "docs/meeting-transcripts").mkdir(parents=True)
        (self.client / "docs/spec.md").write_text("Original spec.\n")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "docs: initial fixture")
        self.git("remote", "add", "origin", str(self.remote))
        self.git("push", "-q", "origin", "main")
        self.config = {"project":{"repo_path":str(self.client)}, "github":{"base_branch":"main"},
                       "roles":{role:{"model":"fixture", "variant":"high"} for role in ("distiller", "reviewer")},
                       "rules":{"session_timeout_sec":10}, "domains":{"spec_sync":{"enabled":True,"max_attempts":2}}}
        self.save_config()
        (self.root / "pr.json").write_text("[]")
        (self.root / "run/spawn").write_text(FAKE_SPAWN)
        (self.root / "run/spawn").chmod(0o755)
        bindir = self.root / "bin"
        bindir.mkdir()
        (bindir / "gh").write_text(FAKE_GH)
        (bindir / "gh").chmod(0o755)
        self.env = dict(os.environ, FIXTURE_ROOT=str(self.root), KOKOLOG_STATE=str(self.state),
                        KOKOLOG_SESSIONS=str(self.state / "sessions"), PATH=str(bindir) + os.pathsep + os.environ["PATH"])

    def tearDown(self):
        self.temp.cleanup()

    def must(self, *args, **kwargs):
        result = run(*args, **kwargs)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def git(self, *args):
        return self.must("git", *args, cwd=self.client)

    def save_config(self):
        (self.root / "config.json").write_text(json.dumps(self.config))

    def transcript(self, name="meeting_20260901.txt", text="Approved: update the spec.\n"):
        path = self.client / "docs/meeting-transcripts" / name
        path.write_text(text)
        os.utime(path, (time.time() - 20, time.time() - 20))
        return hashlib.sha256(text.encode()).hexdigest()

    def trigger(self, mode="NOOP", *args):
        return run(str(self.root / "run/spec-sync-trigger"), *(args or ("--manual",)), env=dict(self.env, FIXTURE_MODE=mode))

    def test_false_and_invalid_config_do_not_dispatch(self):
        self.transcript()
        for value, status in ((False, 0), ("false", 1), (None, 1)):
            self.config["domains"]["spec_sync"]["enabled"] = value
            self.save_config()
            self.assertEqual(self.trigger().returncode, status)
        self.assertFalse((self.root / "actor-calls").exists())

    def test_paused_timer_does_not_dispatch(self):
        self.transcript()
        result = self.trigger("NOOP", "--card", "unused")
        self.assertEqual(result.returncode, 0)
        self.assertIn("paused", result.stdout)

    def test_local_drop_creates_verified_draft_and_repeat_is_noop(self):
        key = self.transcript()
        before = self.git("rev-parse", "HEAD")
        result = self.trigger("PASS")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f"{key}\tcompleted", (self.state / "specsync.ledger").read_text())
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertIn("?? docs/meeting-transcripts/", self.git("status", "--porcelain"))
        result = self.trigger("PASS")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len((self.root / "actor-calls").read_text().splitlines()), 1)
        proof = Path((self.root / "verifier-workdir").read_text())
        self.assertTrue((proof / "source/docs/spec.md").is_file())
        self.assertEqual(json.loads((proof / "runtime.json").read_text())["diff_check_exit"], 0)

    def test_date_order_and_new_file_settle(self):
        later = self.transcript("meeting_20260903.txt", "later\n")
        earlier = self.transcript("meeting_20260801.txt", "earlier\n")
        fresh = self.client / "docs/meeting-transcripts/meeting_20260701.txt"
        fresh.write_text("still copying\n")
        result = self.trigger()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        ledger = (self.state / "specsync.ledger").read_text()
        self.assertIn(earlier, ledger)
        self.assertNotIn(later, ledger)

    def test_crash_after_terminal_cycle_recovers_without_actor(self):
        key = self.transcript()
        first = self.trigger("PASS")
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        (self.state / "specsync.ledger").write_text("")
        second = self.trigger("PASS")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("recovered PASS", second.stdout)
        self.assertEqual(len((self.root / "actor-calls").read_text().splitlines()), 1)

    def test_concurrent_trigger_respects_lock(self):
        import fcntl
        self.transcript()
        with (self.state / "specsync.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = self.trigger()
        self.assertEqual(result.returncode, 0)
        self.assertIn("claim lock", result.stdout)
        self.assertFalse((self.root / "actor-calls").exists())

    def test_blocked_retry_needs_matching_decided_card(self):
        key = self.transcript()
        first = self.trigger("BLOCKED")
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertIn("blocked", (self.state / "specsync.ledger").read_text())
        denied = self.trigger("NOOP", "--retry", key, "--card", "decisions/fixture.card.md")
        self.assertEqual(denied.returncode, 1)
        card = self.root / "decisions/fixture.card.md"
        card.write_text(card.read_text().replace("status: open", "status: decided"))
        allowed = self.trigger("NOOP", "--retry", key, "--card", "decisions/fixture.card.md")
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        result = self.trigger("PASS")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len((self.root / "actor-calls").read_text().splitlines()), 2)

    def test_exhaustion_preserves_attempts_and_creates_card(self):
        key = self.transcript()
        self.assertEqual(self.trigger("FAIL").returncode, 1)
        self.assertEqual(self.trigger("FAIL").returncode, 1)
        self.assertEqual(self.trigger("FAIL").returncode, 1)
        self.assertEqual((self.state / "specsync-attempts" / key).read_text(), "2\n")
        self.assertIn("failed", (self.state / "specsync.ledger").read_text())
        card = self.root / "decisions" / f"auto-specsync-blocked-{key[:12]}.card.md"
        self.assertIn(f"spec-sync:{key}", card.read_text())

    def test_runtime_rejects_wrong_base_nondraft_code_and_bad_verifier(self):
        self.transcript()
        reasons = {"WRONG_BASE":"PR targets the wrong base", "NOT_DRAFT":"PASS requires an open draft PR",
                   "CODE_CHANGE":"PR must change documentation", "VERIFY_FAIL":"Fixture verifier result.",
                   "MISSING_EVIDENCE":"verifier omitted required", "MUTATE_PR":"PR changed after evidence capture"}
        for mode, reason in reasons.items():
            with self.subTest(mode=mode):
                (self.root / "pr.json").write_text("[]")
                shutil.rmtree(self.state / "specsync-attempts", ignore_errors=True)
                result = self.trigger(mode)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn(reason, result.stdout + result.stderr)
                self.assertNotIn("completed", (self.state / "specsync.ledger").read_text())

    def test_source_hash_mismatch_is_rejected(self):
        value = {"revision": self.git("rev-parse", "HEAD"), "path":"docs/spec.md", "hash":"0" * 64}
        with self.assertRaisesRegex(ValueError, "hash"):
            evidence.verify_source(self.client, value)

    def test_existing_draft_is_reused_after_failed_verification(self):
        self.transcript()
        failed = self.trigger("VERIFY_FAIL")
        self.assertEqual(failed.returncode, 1, failed.stdout + failed.stderr)
        previous = json.loads((self.root / "pr.json").read_text())
        reused = self.trigger("REUSE")
        self.assertEqual(reused.returncode, 0, reused.stdout + reused.stderr)
        self.assertEqual(json.loads((self.root / "pr.json").read_text()), previous)

    def test_arbitrary_markdown_name_and_temporary_file(self):
        self.transcript("meeting notes.md")
        self.transcript("meeting.partial.txt", "incomplete")
        result = self.trigger("PASS")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("partial", (self.state / "specsync.snapshot").read_text())

    def test_duplicate_operation_prs_fail_before_actor(self):
        self.transcript()
        self.assertEqual(self.trigger("VERIFY_FAIL").returncode, 1)
        prs = json.loads((self.root / "pr.json").read_text())
        (self.root / "pr.json").write_text(json.dumps(prs + prs))
        result = self.trigger()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len((self.root / "actor-calls").read_text().splitlines()), 1)

    def test_exhaustion_card_failure_does_not_acknowledge(self):
        key = self.transcript()
        self.assertEqual(self.trigger("FAIL").returncode, 1)
        self.assertEqual(self.trigger("FAIL").returncode, 1)
        shutil.rmtree(self.root / "decisions")
        (self.root / "decisions").write_text("not a directory")
        result = self.trigger("FAIL")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("failed", (self.state / "specsync.ledger").read_text())

    def test_document_base_uses_remote_revision_without_changing_local_head(self):
        self.transcript()
        old_head = self.git("rev-parse", "HEAD")
        upstream = self.root / "upstream"
        self.must("git", "clone", "-q", "-b", "main", str(self.remote), str(upstream))
        (upstream / "docs/new-base.md").write_text("Remote base addition.\n")
        self.must("git", "add", ".", cwd=upstream)
        self.must("git", "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "docs: advance remote base", cwd=upstream)
        self.must("git", "push", "-q", "origin", "main", cwd=upstream)
        result = self.trigger("PASS")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        proof = Path((self.root / "verifier-workdir").read_text())
        self.assertEqual((proof / "source/docs/new-base.md").read_text(), "Remote base addition.\n")
        self.assertEqual(self.git("rev-parse", "HEAD"), old_head)


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(TranscriptTests))
    if not result.wasSuccessful():
        sys.exit(1)
    print("SPEC_SYNC_TESTS_OK")
