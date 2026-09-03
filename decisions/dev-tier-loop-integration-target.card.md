---
kind: card
status: decided
domain: implement
parked-by: orchestrator
date: 2026-09-03 22:17
decided-by: owner (operator console)
decided: 2026-09-03
---

# Which environment should loop-run integration checks target: the local dev tier or the authorized environment (#109)?

## Context

The loop queue shows #109 (authorized non-production Cloud environment) as an
external-owner item with 19 downstream issues. ARD019 §5 (kokolog-monitor)
already fixes a local test harness as the way to unblock client work without
waiting for cloud deployment. The dev tier is now one-command controllable via
`apps/cloud_platform/scripts/dev-env.sh` (broker in Docker, API on host, dev CA
certs, seed API). The loop needs a ruling on whether its integration checks run
against that dev tier, or wait for #109.

## Option A — Dev tier is the standard integration target

- What: loop tickets and domain checks use `commands.integration` against the
  dev tier (`dev-env.sh up` then run). The authorized tier (#109) stays a
  human evidence gate for closing #109/#95 only.
- Better: no human gate per run; deterministic reset per session; works today.
- Worse: dev-CA trust steps on devices stay manual; environment is per-machine,
  not shared.

## Option B — Wait for the authorized environment

- What: no loop integration checks until #109 is deployed and signed off.
- Better: one environment, publicly trusted certs, shared.
- Worse: blocked on human domain + sign-off; contradicts ARD019 §5 intent to
  unblock client development locally; 19 downstream items stay gated.

## Option C — Mocks for loop checks

- What: loop checks run against fake API/broker instead of the real stack.
- Better: zero infrastructure.
- Worse: #47/#48 acceptance requires tests "against the implemented service,
  not only fixtures or mocks"; mock drift hides contract violations.

## Evidence

- kokolog-monitor/docs/ard/ARD019-cloud-platform-and-integration-service-foundation.md (§3, §4, §5)
- kokolog-monitor/apps/cloud_platform/scripts/dev-env.sh (new, this change)
- kokolog-monitor/apps/cloud_platform/docker-compose.dev.yml (new, this change)
- kokolog-loop/web/status.mjs:399 (deps label -> external owner)
- https://github.com/kokoromil/kokolog-monitor/issues/109 (deps, need-evidence)

## Recommendation

A — it is the only option that is fully agentic today and it is already the
documented intent of ARD019 §5. Known gap in both tiers: EMQX does not yet
validate MQTT tokens or enforce topic ACLs (tracked as follow-up work; the
broker currently accepts anonymous connections).

## Default if unanswered

A stays available to human developers; the loop does not run integration
checks and does not gate any ticket on them until this card is decided.

## Decision

Option A — Dev tier is the standard integration target.
