#!/bin/bash
# common.sh — shared library for kokolog-loop scripts. Sourced, not run.
# Sentinel pattern adapted from AI-Builder-Club's open-agent-teams (file
# sentinels over tmux wait-for: never silently lost).

LOOP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$LOOP_ROOT/state"
SESSIONS="$STATE/sessions"
LOGS="$LOOP_ROOT/logs"
VERDICTS="$LOOP_ROOT/verdicts"
CLONES="$LOOP_ROOT/clones"
LOCK="$LOOP_ROOT/lock"
LOGMD="$LOOP_ROOT/LOG.md"
ROUTING="$LOOP_ROOT/routing.json"

# --- config ---------------------------------------------------------------
KOKOLOG_REPO="$(jq -r '.project.repo_path // empty' "$ROUTING")"
export KOKOLOG_REPO

jqget() { jq -r "$1" "$ROUTING"; }

role_alias() { jq -r --arg r "$1" '.roles[$r].model // empty' "$ROUTING"; }
alias_model() { jq -r --arg a "$1" '.aliases[$a].model // empty' "$ROUTING"; }
alias_variant() { jq -r --arg a "$1" '.aliases[$a].variant // empty' "$ROUTING"; }
route_model() { alias_model "$(role_alias "$1")"; }
route_variant() { alias_variant "$(role_alias "$1")"; }

rule() { jq -r --arg k "$1" '.rules[$k]' "$ROUTING"; }

branch_slug() { # title -> short ASCII kebab slug; unique issue number lives outside
  local slug
  slug="$(printf '%s' "$1" |
    LC_ALL=C tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g' |
    cut -c1-64 |
    sed -E 's/-+$//')"
  printf '%s\n' "${slug:-work}"
}

branch_prefix_valid() { # lowercase kebab prefix
  [[ "$1" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] &&
    git check-ref-format --branch "${1}-1/work" >/dev/null 2>&1
}

domain_active() { # domain -> 0 if status: active
  local f="$LOOP_ROOT/domains/$1/README.md"
  [ -f "$f" ] || return 1
  grep -q '^status: *active' "$f"
}

# --- state files: state/<ticket>.<state> -----------------------------------
st_set() { # ticket, state
  rm -f "$STATE/$1.in-progress" "$STATE/$1.review" "$STATE/$1.fix" \
    "$STATE/$1.done" "$STATE/$1.parked"
  printf '%s\n' "$2" > "$STATE/$1.$2"
}
st_has() { [ -e "$STATE/$1.$2" ]; }                       # ticket, state
st_exists() { ls "$STATE/$1".* >/dev/null 2>&1; }         # ticket

# --- LOG.md grammar (see LOG.md header) -------------------------------------
log_append() { # title tag what refs
  {
    printf '## %s · %s · #%s\n' "$(date +%F)" "$1" "$2"
    printf 'What: %s\n' "$3"
    printf 'Refs: %s\n' "$4"
  } >> "$LOGMD"
}

# Runtime-parked decision card for a failed work unit. Deduped by slug; the
# card arrives OPEN and is answered like any other card. Record-only: the
# answer is applied by a later, deliberate step — never by this helper.
park_auto_card() { # slug domain question context evidence -> 0 if parked, 1 if exists or failed
  local file="$LOOP_ROOT/decisions/auto-$1.card.md"
  [ -e "$file" ] && return 1
  local tmp="$file.tmp.$$"
  {
    printf -- '---\nkind: card\nstatus: open\ndomain: %s\nparked-by: runtime (auto-cardify)\ndate: %s\n---\n\n' "$2" "$(date '+%F %H:%M')"
    printf '# %s\n\n' "$3"
    printf '## Context\n\n%s\n\n' "$4"
    printf '## Option A — Retry the cycle\n\n- What: re-run the failed cycle; bounds and attempts permitting.\n- Better: the loop completes the work itself.\n- Worse: may repeat the same failure.\n\n'
    printf '## Option B — Drop the work unit\n\n- What: acknowledge the failure and skip this work unit.\n- Better: no repeated spend on a hopeless item.\n- Worse: the work stays undone until raised again.\n\n'
    printf '## Option C — Take over manually\n\n- What: a human does or repairs the work outside the loop.\n- Better: fastest unblock for odd cases.\n- Worse: manual record-keeping; the loop learns nothing.\n\n'
    printf '## Evidence\n\n%s\n\n' "$5"
    printf '## Recommendation\n\nA — unless the evidence shows the work unit itself is wrong.\n\n'
    printf '## Default if unanswered\n\nA — retry within bounds at the next batch; the card stays open until answered.\n'
  } > "$tmp" && mv "$tmp" "$file" || { rm -f "$tmp"; return 1; }
  return 0
}

timeline() { # domain line
  local f="$LOOP_ROOT/domains/$1/README.md"
  [ -f "$f" ] || return 0
  grep -q '^## Timeline' "$f" || return 0
  awk -v line="$(date +%F) | $2" '
    /^## Timeline/ && !done { print; print line; done=1; next }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}

metric() { # domain file json-line
  local d="$LOOP_ROOT/domains/$1"
  mkdir -p "$d/metrics"
  printf '{"t":"%s",%s}\n' "$(date -u +%FT%TZ)" "$3" >> "$d/metrics/$2"
}

tmux_session_prefix="kokoloop"

acquire_lock() {
  if [ -e "$LOCK" ]; then
    local pid; pid="$(cat "$LOCK" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 1 # a tick is running; ours are idempotent, just skip
    fi
  fi
  printf '%s\n' $$ > "$LOCK"
}

release_lock() { rm -f "$LOCK"; }

# resolve GitHub owner/name from the configured checkout
ghrepo() {
  local url r
  url="$(git -C "$KOKOLOG_REPO" remote get-url origin 2>/dev/null)" || return 1
  # git@github.com:owner/name.git | https://github.com/owner/name.git | ssh://
  r="$(printf '%s' "$url" | sed -E 's#.*github\.com[:/]##; s#\.git$##')"
  case "$r" in
    */*) ;;
    *) r="$( cd "$KOKOLOG_REPO" && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null )" || return 1 ;;
  esac
  printf '%s\n' "$r"
}
