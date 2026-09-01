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

route_model() { jq -r --arg r "$1" '.roles[$r].model // empty' "$ROUTING"; }
route_variant() { jq -r --arg r "$1" '.roles[$r].variant // empty' "$ROUTING"; }

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
github_issue_number_from_pr() { # PR URL -> number
  local pr="$1" number="${1##*/}"
  case "$pr:$number" in
    https://github.com/*/pull/[0-9]*:[0-9]*) printf '%s\n' "$number" ;;
    *) return 1 ;;
  esac
}

github_known_pr() { # ticket -> PR URL when recorded
  local n="$1" rs="$STATE/$1.review.json"
  if [ -s "$STATE/$n.pr" ]; then
    sed -n '1p' "$STATE/$n.pr"
  elif [ -s "$rs" ]; then
    jq -r '.pr // empty' "$rs"
  fi
}

github_add_label() { # repo issue-or-pr-number label
  gh api --silent --method POST "repos/$1/issues/$2/labels" -f "labels[]=$3" >/dev/null 2>&1
}

github_remove_label() { # repo issue-or-pr-number label; absent is already clear
  gh api --silent --method DELETE "repos/$1/issues/$2/labels/$3" >/dev/null 2>&1 || true
}

github_post_need_decision() { # repo issue-or-pr-number ticket reason
  local repo="$1" target="$2" n="$3" reason="$4" body
  printf -v body '<!-- kokolog-loop:need-decision -->\n**Status: `need-decision`**\n\nAutomated work is paused.\n\nReason: %s\n\nIssue #%s and its pull request stay open until an owner selects a disposition.' \
    "$reason" "$n"
  gh api --silent --method POST "repos/$repo/issues/$target/comments" -f "body=$body" >/dev/null 2>&1
}

github_mark_need_decision() { # ticket reason notify-comment(0|1)
  local n="$1" reason="${2:-reason not recorded}" notify="${3:-0}" repo label frontier pr prn target notice
  label="$(jqget '.github.decision_label // empty')"
  frontier="$(jqget '.github.frontier_label // empty')"
  [ -n "$label" ] && repo="$(ghrepo 2>/dev/null)" && [ -n "$repo" ] || return 1
  github_add_label "$repo" "$n" "$label" || return 1
  [ -z "$frontier" ] || github_remove_label "$repo" "$n" "$frontier"
  target="$n"
  pr="$(github_known_pr "$n")"
  if [ -n "$pr" ]; then
    prn="$(github_issue_number_from_pr "$pr")" || return 1
    github_add_label "$repo" "$prn" "$label" || return 1
    target="$prn"
  fi
  notice="$STATE/$n.need-decision-notice"
  if [ "$notify" = 1 ] || [ "$(cat "$notice" 2>/dev/null || true)" != "$target" ]; then
    github_post_need_decision "$repo" "$target" "$n" "$reason" || return 1
    printf '%s\n' "$target" > "$notice"
  fi
}

github_clear_need_decision() { # ticket, resumed state
  local n="$1" resumed="$2" repo label frontier pr prn
  label="$(jqget '.github.decision_label // empty')"
  frontier="$(jqget '.github.frontier_label // empty')"
  [ -n "$label" ] && repo="$(ghrepo 2>/dev/null)" && [ -n "$repo" ] || return 1
  github_remove_label "$repo" "$n" "$label"
  case "$resumed" in
    ready|in-progress|review|fix) [ -z "$frontier" ] || github_add_label "$repo" "$n" "$frontier" || return 1 ;;
  esac
  pr="$(github_known_pr "$n")"
  if [ -n "$pr" ]; then
    prn="$(github_issue_number_from_pr "$pr")" || return 1
    github_remove_label "$repo" "$prn" "$label"
  fi
  rm -f "$STATE/$n.need-decision-notice"
}

st_set() { # ticket state [reason]
  local reason="${3:-}" was_parked=0
  [ -e "$STATE/$1.parked" ] && was_parked=1
  rm -f "$STATE/$1.ready" "$STATE/$1.in-progress" "$STATE/$1.review" \
    "$STATE/$1.fix" "$STATE/$1.done" "$STATE/$1.parked" \
    "$STATE/$1.blocked-decision" "$STATE/$1.merged-unverified" \
    "$STATE/$1.merged" "$STATE/$1.merged-audited" \
    "$STATE/$1.manual-takeover"
  if [ "$2" = parked ] && [ -n "$reason" ]; then
    printf '%s\n' "$reason" > "$STATE/$1.$2"
  else
    printf '%s\n' "$2" > "$STATE/$1.$2"
  fi
  if [ "$2" = parked ]; then
    github_mark_need_decision "$1" "${reason:-reason not recorded}" "$((1 - was_parked))" || \
      printf 'warning: could not apply need-decision context to ticket %s\n' "$1" >&2
  elif [ "$was_parked" = 1 ]; then
    github_clear_need_decision "$1" "$2" || printf 'warning: could not clear need-decision from ticket %s\n' "$1" >&2
  fi
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
    printf '## Option C — Take over manually\n\n- What: the owner does or repairs the work outside automated control.\n- Better: fastest unblock for odd cases.\n- Worse: manual record-keeping; the controller gains no reusable evidence.\n\n'
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
  local pid reap="$LOCK.reap"
  if mkdir "$LOCK" 2>/dev/null; then
    printf '%s\n' $$ > "$LOCK/pid"
    return 0
  fi
  if [ -d "$LOCK" ]; then pid="$(cat "$LOCK/pid" 2>/dev/null || true)"; else pid="$(cat "$LOCK" 2>/dev/null || true)"; fi
  [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null || return 1
  mkdir "$reap" 2>/dev/null || return 1
  printf '%s\n' $$ > "$reap/pid"
  if [ -d "$LOCK" ]; then pid="$(cat "$LOCK/pid" 2>/dev/null || true)"; else pid="$(cat "$LOCK" 2>/dev/null || true)"; fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    rm -rf "$reap"
    return 1
  fi
  rm -rf "$LOCK"
  if mkdir "$LOCK" 2>/dev/null; then
    printf '%s\n' $$ > "$LOCK/pid"
    rm -rf "$reap"
    return 0
  fi
  rm -rf "$reap"
  return 1
}

release_lock() {
  [ -d "$LOCK" ] && [ "$(cat "$LOCK/pid" 2>/dev/null || true)" = "$$" ] && rm -rf "$LOCK"
  return 0
}

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
