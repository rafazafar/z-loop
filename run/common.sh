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

# --- config (secrets/overrides live in gitignored config.env) -------------
KOKOLOG_REPO="${KOKOLOG_REPO:-/Users/zafar/dev/kokolog-monitor}"
# shellcheck disable=SC1090
[ -f "$LOOP_ROOT/config.env" ] && . "$LOOP_ROOT/config.env"
export KOKOLOG_REPO

jqget() { jq -r "$1" "$ROUTING"; }

route_model() { # role -> full provider/model string (hyphen-safe via --arg)
  local alias
  alias="$(jq -r --arg r "$1" '.roles[$r].model // empty' "$ROUTING")"
  [ -n "$alias" ] && jq -r --arg a "$alias" '.aliases[$a] // empty' "$ROUTING"
}

rule() { jq -r --arg k "$1" '.rules[$k]' "$ROUTING"; }

domain_active() { # domain -> 0 if status: active
  local f="$LOOP_ROOT/domains/$1/README.md"
  [ -f "$f" ] || return 1
  grep -q '^status: *active' "$f"
}

# --- state files: state/<ticket>.<state> -----------------------------------
st_set() { printf '%s\n' "$2" > "$STATE/$1.$2"; }        # ticket, state
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

# resolve GitHub owner/name for the client repo, cached
ghrepo() {
  if [ -f "$STATE/ghrepo" ]; then cat "$STATE/ghrepo"; return 0; fi
  local url r
  url="$(git -C "$KOKOLOG_REPO" remote get-url origin 2>/dev/null)" || return 1
  # git@github.com:owner/name.git | https://github.com/owner/name.git | ssh://
  r="$(printf '%s' "$url" | sed -E 's#.*github\.com[:/]##; s#\.git$##')"
  case "$r" in
    */*) ;;
    *) r="$( cd "$KOKOLOG_REPO" && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null )" || return 1 ;;
  esac
  mkdir -p "$STATE"
  printf '%s\n' "$r" > "$STATE/ghrepo"
  printf '%s\n' "$r"
}
