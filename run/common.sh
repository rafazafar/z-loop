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

ticket_session_live() { # ticket-number
  local n="$1"
  tmux list-sessions -F '#S' 2>/dev/null | grep -qE "^${tmux_session_prefix}-${n}-(impl|rev)-"
}

# --- rate-limiting / circuit breaker -----------------------------------------
detect_api_rate_limit() { # session-id
  local sid="$1" logfile="$LOGS/$sid.jsonl"
  [ -s "$logfile" ] || return 1
  jq -e 'select(.type=="error") | .error.data | (.statusCode == 429 or .statusCode == 524 or ((.message // "") | test("429|quota|rate limit|too many requests"; "i")))' "$logfile" >/dev/null 2>&1
}

extract_retry_after() { # session-id
  local sid="$1" logfile="$LOGS/$sid.jsonl" val
  val="$(jq -r 'select(.type=="error") | .error.data.responseHeaders["retry-after"] // .error.data["retry-after"] // empty' "$logfile" 2>/dev/null | head -n 1)"
  case "$val" in ''|*[!0-9]*) val="" ;; esac
  if [ -z "$val" ]; then
    val="$(grep -oE 'reset after [0-9]+s' "$logfile" 2>/dev/null | grep -oE '[0-9]+' | head -n 1)"
  fi
  case "$val" in ''|*[!0-9]*) val=180 ;; esac
  [ "$val" -lt 60 ] && val=60
  printf '%s\n' "$val"
}

trip_circuit_breaker() { # session-id role [reason]
  local sid="$1" role="$2" reason="${3:-API rate limit or quota exceeded}"
  local retry_sec cooldown_until model
  retry_sec="$(extract_retry_after "$sid")"
  cooldown_until="$(date -u -v+"${retry_sec}"S +%FT%TZ 2>/dev/null || date -u -d "+${retry_sec} seconds" +%FT%TZ 2>/dev/null || date -u +%FT%TZ)"
  model="$(route_model "$role")"
  jq -n --arg model "$model" --arg role "$role" --arg reason "$reason" \
    --arg tripped_at "$(date -u +%FT%TZ)" --arg cooldown_until "$cooldown_until" \
    --argjson retry_after "$retry_sec" --arg sid "$sid" \
    '{status: "tripped", model: $model, role: $role, failed_session: $sid, reason: $reason, tripped_at: $tripped_at, cooldown_until: $cooldown_until, retry_after_sec: $retry_after}' > "$STATE/circuit-breaker.json.tmp" &&
    mv "$STATE/circuit-breaker.json.tmp" "$STATE/circuit-breaker.json"
}

circuit_breaker_active() {
  local cb_file="$STATE/circuit-breaker.json" now until until_sec
  [ -f "$cb_file" ] || return 1
  until="$(jq -r '.cooldown_until // empty' "$cb_file" 2>/dev/null)"
  [ -n "$until" ] || { rm -f "$cb_file"; return 1; }
  now="$(date -u +%s)"
  until_sec="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$until" +%s 2>/dev/null || date -d "$until" +%s 2>/dev/null || echo 0)"
  if [ "$now" -lt "$until_sec" ]; then
    return 0
  fi
  rm -f "$cb_file"
  return 1
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

github_pr_view() { # pr repo [fields]
  local pr="$1" repo="$2" prn fields="${3:-number,state,headRefName,headRefOid,mergeable,mergeStateStatus}" json
  prn="${pr##*/}"
  if json="$(gh pr view "$pr" -R "$repo" --json "$fields" 2>/dev/null)"; then
    printf '%s\n' "$json"
    return 0
  fi
  gh api "repos/$repo/pulls/$prn" --jq '{
    number: .number,
    state: (.state | ascii_upcase),
    headRefName: .head.ref,
    headRefOid: .head.sha,
    baseRefName: .base.ref,
    baseRefOid: .base.sha,
    mergeable: (if .mergeable == null then "UNKNOWN" elif .mergeable then "MERGEABLE" else "CONFLICTING" end),
    mergeStateStatus: (.mergeable_state | if . == null then "UNKNOWN" else ascii_upcase end),
    title: .title,
    url: .html_url,
    closingIssuesReferences: []
  }' 2>/dev/null
}

github_pr_is_conflicted() { # pr repo
  local pr="$1" repo="$2" meta mergeable state_status
  meta="$(github_pr_view "$pr" "$repo" "mergeable,mergeStateStatus")" || return 1
  mergeable="$(printf '%s' "$meta" | jq -r '.mergeable // empty' 2>/dev/null)"
  state_status="$(printf '%s' "$meta" | jq -r '.mergeStateStatus // empty' 2>/dev/null)"
  [ "$mergeable" = "CONFLICTING" ] || [ "$state_status" = "DIRTY" ]
}

github_pr_checks() { # pr repo head_sha
  local pr="$1" repo="$2" head="${3:-}" json
  if json="$(gh pr view "$pr" -R "$repo" --json statusCheckRollup 2>/dev/null)"; then
    printf '%s\n' "$json"
    return 0
  fi
  [ -n "$head" ] || head="$(github_pr_view "$pr" "$repo" headRefOid | jq -r '.headRefOid // empty' 2>/dev/null || true)"
  [ -n "$head" ] || return 1
  gh api "repos/$repo/commits/$head/check-runs" --jq '{
    statusCheckRollup: [.check_runs[] | {
      name: .name,
      status: (.status | ascii_upcase),
      conclusion: .conclusion,
      __typename: "CheckRun"
    }]
  }' 2>/dev/null
}

github_issue_view() { # issue_number repo [fields]
  local n="$1" repo="$2" fields="${3:-url,title,body,labels}" json
  if json="$(gh issue view "$n" -R "$repo" --json "$fields" 2>/dev/null)"; then
    printf '%s\n' "$json"
    return 0
  fi
  gh api "repos/$repo/issues/$n" --jq '{
    url: .html_url,
    title: .title,
    body: (.body // ""),
    labels: [.labels[] | {name: .name}],
    subIssues: {totalCount: 0, nodes: []},
    blockedBy: {nodes: []}
  }' 2>/dev/null
}

github_open_pr_for_branch() { # repo branch
  local repo="$1" branch="$2" url
  if url="$(gh pr list -R "$repo" --state open --head "$branch" --json url --jq '.[0].url // empty' 2>/dev/null)" && [ -n "$url" ]; then
    printf '%s\n' "$url"
    return 0
  fi
  gh api "repos/$repo/pulls?state=open&head=${repo%%/*}:$branch" --jq '.[0].html_url // empty' 2>/dev/null
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
  local n="$1" resumed="$2" repo label pr prn
  label="$(jqget '.github.decision_label // empty')"
  [ -n "$label" ] && repo="$(ghrepo 2>/dev/null)" && [ -n "$repo" ] || return 1
  github_remove_label "$repo" "$n" "$label"
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
    "$STATE/$1.runtime-failed" \
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

worker_result_path() { # checkout session-id
  printf '%s/.git/kokolog-loop/%s.result\n' "$1" "$2"
}

worker_verdict_path() { # checkout session-id
  printf '%s/.git/kokolog-loop/%s.verdict.md\n' "$1" "$2"
}

valid_session_pgid() { # process-group-id
  local pgid="$1" own
  case "$pgid" in ''|*[!0-9]*|0|1) return 1 ;; esac
  own="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
  [ "$pgid" != "$own" ]
}

session_pgid() { # session-id
  local id="$1" pgid pane_pid
  pgid="$(cat "$SESSIONS/$id.pgid" 2>/dev/null | tr -d ' ')"
  if ! valid_session_pgid "$pgid"; then
    pane_pid="$(tmux list-panes -t "${tmux_session_prefix}-${id}" -F '#{pane_pid}' 2>/dev/null | head -1)"
    pgid="$(ps -o pgid= -p "$pane_pid" 2>/dev/null | tr -d ' ')"
  fi
  valid_session_pgid "$pgid" || return 1
  printf '%s\n' "$pgid"
}

process_group_alive() { # process-group-id
  valid_session_pgid "$1" && kill -0 -- "-$1" 2>/dev/null
}

terminate_session() { # session-id [TERM grace seconds]
  local id="$1" grace="${2:-5}" pgid waited=0
  pgid="$(session_pgid "$id" 2>/dev/null || true)"
  if [ -n "$pgid" ]; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
    while process_group_alive "$pgid" && [ "$waited" -lt "$grace" ]; do
      sleep 1
      waited=$((waited + 1))
    done
    if process_group_alive "$pgid"; then
      kill -KILL -- "-$pgid" 2>/dev/null || true
      sleep 1
    fi
  fi
  tmux kill-session -t "${tmux_session_prefix}-${id}" 2>/dev/null || true
  [ -z "$pgid" ] || ! process_group_alive "$pgid"
}

workdir_lock_path() { # absolute workdir
  local key
  key="$(printf '%s' "$1" | shasum -a 256 | awk '{print $1}')"
  printf '%s/workdir-locks/%s.lock\n' "$SESSIONS" "$key"
}

workdir_has_live_owner() { # absolute workdir [allowed session id]
  local lock owner pgid allowed="${2:-}"
  lock="$(workdir_lock_path "$1")"
  [ -d "$lock" ] || return 1
  owner="$(cat "$lock/session" 2>/dev/null || true)"
  [ -n "$allowed" ] && [ "$owner" = "$allowed" ] && return 1
  pgid="$(cat "$lock/pgid" 2>/dev/null | tr -d ' ')"
  process_group_alive "$pgid"
}

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
