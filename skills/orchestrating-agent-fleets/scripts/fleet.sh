#!/usr/bin/env sh
# fleet.sh — mechanical automation for orchestrating-agent-fleets.
#
# Runtime-agnostic helper for the master orchestrator. Handles the boilerplate
# that is identical whether the fleet runs on Herdr+Pi, ORCA, or bare git:
# wave scaffolding, worktree/branch provisioning, kanban creation, file-scope
# overlap detection, and the expensive-test deduplication registry.
#
# It does NOT create sessions/panes/tasks — that is the runtime adapter's job
# (see runtime-adapters.md). It owns git + local coordination files only.
#
# Usage:
#   fleet.sh init <wave-id> [max-test-workers]
#   fleet.sh expect <wave-id> <pod>...            declare expected pods for the wave
#   fleet.sh check  <wave-id>                     expected pods vs handoffs found (silent-failure guard)
#   fleet.sh pod  <wave-id> <pod-name> <architect> [base-sha]
#   fleet.sh worktree <wave-id> <pod> <role> [n] [base-sha]
#       role = integration | worker | review | test
#   fleet.sh overlap "<globsA>" "<globsB>"
#   fleet.sh test-key   <sha> <command> <env> <config>
#   fleet.sh test-check <wave-id> <sha> <command> <env> <config>
#   fleet.sh test-record <wave-id> <sha> <command> <env> <config> <status> <evidence-path> [worker]
#   fleet.sh status <wave-id>
#
# All state lives under (both git-ignored):
#   .orchestration/wave-<id>/   coordination kanbans + test registry
#   .worktrees/wave-<id>/       isolated writer checkouts
set -eu

ORCH_DIR=".orchestration"
WT_DIR=".worktrees"

die() { printf 'fleet: %s\n' "$1" >&2; exit 1; }

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || die "not inside a git repository"
}

sha256_of() {
  # Portable sha256: prefer sha256sum (Linux), fall back to shasum -a 256 (macOS).
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -c1-16
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -c1-16
  else
    die "need sha256sum or shasum on PATH"
  fi
}

ensure_gitignore() {
  root="$1"
  gi="$root/.gitignore"
  for entry in "$ORCH_DIR/" "$WT_DIR/"; do
    if [ ! -f "$gi" ] || ! grep -qxF "$entry" "$gi" 2>/dev/null; then
      printf '%s\n' "$entry" >> "$gi"
      printf 'fleet: added %s to .gitignore\n' "$entry" >&2
    fi
  done
}

wave_dir()   { printf '%s/%s/wave-%s' "$(repo_root)" "$ORCH_DIR" "$1"; }
wt_wave()    { printf '%s/%s/wave-%s' "$(repo_root)" "$WT_DIR" "$1"; }

# execution key for expensive-test dedup: exact tuple defines identity.
exec_key() {
  # $1 sha  $2 command  $3 env  $4 config
  sha256_of "SHA=$1|CMD=$2|ENV=$3|CFG=$4"
}

# ---------------------------------------------------------------------------

cmd_init() {
  [ $# -ge 1 ] || die "init needs <wave-id>"
  wave="$1"; max_tw="${2:-2}"
  root="$(repo_root)"
  ensure_gitignore "$root"
  d="$(wave_dir "$wave")"
  mkdir -p "$d"
  mkdir -p "$(wt_wave "$wave")"

  reg="$d/test-registry.tsv"
  if [ ! -f "$reg" ]; then
    printf 'EXEC_KEY\tSTATUS\tTARGET_SHA\tCOMMAND\tENV\tCONFIG\tATTEMPT\tWORKER\tEVIDENCE\tSUBSCRIBERS\n' > "$reg"
  fi

  board="$d/test-pod-kanban.md"
  if [ ! -f "$board" ]; then
    cat > "$board" <<EOF
WAVE: $wave
TEST ARCHITECT: (unassigned)
MAX_TEST_WORKERS: $max_tw
ACTIVE TEST WORKERS: 0
LAST UPDATED: (init)
BOARD STATUS: CURRENT

## Test Workers
| AGENT | STATE | CURRENT TASK | LAST TASK | LAST SHA | SINCE | NEXT_CHECK_IN |
|-------|-------|--------------|-----------|----------|-------|---------------|

## Request registry (mirror of test-registry.tsv — machine copy is authoritative)
| REQUEST ID | EXECUTION KEY | GATE | STATUS | TARGET SHA | WORKER | SUBSCRIBERS | EVIDENCE | NEXT_CHECK_IN |
|------------|---------------|------|--------|------------|--------|-------------|----------|---------------|
EOF
  fi

  printf 'fleet: wave %s ready\n' "$wave"
  printf '  coordination: %s\n' "$d"
  printf '  worktrees:    %s\n' "$(wt_wave "$wave")"
  printf '  test board:   %s\n' "$board"
  printf '  registry:     %s\n' "$reg"
}

cmd_pod() {
  [ $# -ge 2 ] || die "pod needs <wave-id> <pod-name> [architect] [base-sha]"
  wave="$1"; pod="$2"; arch="${3:-(unassigned)}"
  base="${4:-$(git rev-parse HEAD)}"
  d="$(wave_dir "$wave")"
  [ -d "$d" ] || die "wave $wave not initialized — run: fleet.sh init $wave"
  board="$d/pod-$pod-kanban.md"
  [ -f "$board" ] && die "pod board already exists: $board"
  cat > "$board" <<EOF
WAVE: $wave
POD: $pod
ARCHITECT: $arch
BASE SHA: $base
LAST UPDATED: (created)
BOARD STATUS: CURRENT

## Agents
| AGENT | STATE | CURRENT TASK | LAST TASK | LAST SHA | SINCE | NEXT_CHECK_IN |
|-------|-------|--------------|-----------|----------|-------|---------------|

<!-- STATE: ACTIVE | IDLE | BLOCKED | WAITING_REVIEW | WAITING_TEST | OFFLINE -->

## Tasks
| TASK ID | STATUS | OWNER | SCOPE | BRANCH | SHA | DEPENDENCIES | NEXT_CHECK_IN |
|---------|--------|-------|-------|--------|-----|--------------|---------------|

<!-- STATUS: BACKLOG -> READY -> IN_PROGRESS -> REVIEW -> WAITING_TEST -> DONE ; BLOCKED off any -->
EOF
  printf 'fleet: created pod board %s (base %s)\n' "$board" "$base"
}

cmd_worktree() {
  [ $# -ge 3 ] || die "worktree needs <wave-id> <pod> <role> [n] [base-sha]"
  wave="$1"; pod="$2"; role="$3"; n="${4:-}"; base="${5:-}"
  wdir="$(wt_wave "$wave")"
  mkdir -p "$wdir"

  case "$role" in
    integration)
      path="$wdir/pod-$pod-integration"
      branch="wave/$wave/pod-$pod/integration"
      base="${base:-$(git rev-parse HEAD)}"
      git worktree add -b "$branch" "$path" "$base"
      ;;
    worker)
      [ -n "$n" ] || die "worker role needs <n>"
      path="$wdir/pod-$pod-worker-$n"
      branch="wave/$wave/pod-$pod/worker-$n"
      base="${base:-$(git rev-parse HEAD)}"
      git worktree add -b "$branch" "$path" "$base"
      ;;
    review)
      path="$wdir/pod-$pod-review"
      base="${base:-$(git rev-parse HEAD)}"
      git worktree add --detach "$path" "$base"
      ;;
    test)
      # $n is the request-id here; base is the target SHA
      [ -n "$n" ] || die "test role needs <request-id> as 4th arg and <target-sha> as 5th"
      [ -n "$base" ] || die "test role needs <target-sha> as 5th arg"
      path="$wdir/test-worker-$n"
      git worktree add --detach "$path" "$base"
      ;;
    *)
      die "unknown role '$role' (integration|worker|review|test)"
      ;;
  esac
  printf 'fleet: worktree %s\n' "$path"
  [ "${branch:-}" ] && printf '  branch: %s\n' "$branch" || printf '  detached at: %s\n' "$base"
}

cmd_overlap() {
  [ $# -eq 2 ] || die "overlap needs \"<globsA>\" \"<globsB>\" (comma or space separated path globs)"
  a="$1"; b="$2"
  # Expand each glob set against tracked files, compare sorted sets.
  fa="$(mktemp)"; fb="$(mktemp)"
  # shellcheck disable=SC2086
  ( IFS=', '; set -f; for g in $a; do git ls-files -- "$g"; done ) | sort -u > "$fa"
  ( IFS=', '; set -f; for g in $b; do git ls-files -- "$g"; done ) | sort -u > "$fb"
  common="$(comm -12 "$fa" "$fb")"
  rm -f "$fa" "$fb"
  if [ -n "$common" ]; then
    printf 'fleet: OVERLAP DETECTED — these pods share files and cannot run in parallel:\n'
    printf '%s\n' "$common" | sed 's/^/  /'
    exit 2
  fi
  printf 'fleet: no file overlap — pods are independent and safe to parallelize\n'
}

cmd_test_key() {
  [ $# -eq 4 ] || die "test-key needs <sha> <command> <env> <config>"
  exec_key "$1" "$2" "$3" "$4"
}

cmd_test_check() {
  [ $# -eq 5 ] || die "test-check needs <wave-id> <sha> <command> <env> <config>"
  wave="$1"; shift
  key="$(exec_key "$1" "$2" "$3" "$4")"
  reg="$(wave_dir "$wave")/test-registry.tsv"
  [ -f "$reg" ] || die "no registry for wave $wave — run: fleet.sh init $wave"
  row="$(awk -F'\t' -v k="$key" '$1==k{print; found=1} END{if(!found)exit 1}' "$reg" || true)"
  if [ -z "$row" ]; then
    printf 'MISS %s — no evidence, must execute\n' "$key"
    exit 1
  fi
  status="$(printf '%s' "$row" | cut -f2)"
  evidence="$(printf '%s' "$row" | cut -f9)"
  case "$status" in
    PASSED|FAILED) printf 'HIT %s status=%s evidence=%s — REUSE, do not rerun\n' "$key" "$status" "$evidence" ;;
    QUEUED|RUNNING) printf 'INFLIGHT %s status=%s — subscribe, do not launch duplicate\n' "$key" "$status" ;;
    *) printf 'HIT %s status=%s evidence=%s\n' "$key" "$status" "$evidence" ;;
  esac
}

cmd_test_record() {
  [ $# -ge 7 ] || die "test-record needs <wave-id> <sha> <command> <env> <config> <status> <evidence-path> [worker]"
  wave="$1"; sha="$2"; command_="$3"; env_="$4"; config_="$5"; status="$6"; evidence="$7"; worker="${8:-}"
  key="$(exec_key "$sha" "$command_" "$env_" "$config_")"
  reg="$(wave_dir "$wave")/test-registry.tsv"
  [ -f "$reg" ] || die "no registry for wave $wave — run: fleet.sh init $wave"
  tmp="$(mktemp)"
  # Compute next attempt number for this key; preserve prior rows (never overwrite evidence).
  attempt="$(awk -F'\t' -v k="$key" '$1==k{c++} END{print c+1}' "$reg")"
  cp "$reg" "$tmp"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$key" "$status" "$sha" "$command_" "$env_" "$config_" "$attempt" "$worker" "$evidence" "" >> "$tmp"
  mv "$tmp" "$reg"
  printf 'fleet: recorded %s status=%s attempt=%s evidence=%s\n' "$key" "$status" "$attempt" "$evidence"
}

cmd_expect() {
  [ $# -ge 2 ] || die "expect needs <wave-id> <pod>... (space-separated expected pod names)"
  wave="$1"; shift
  d="$(wave_dir "$wave")"
  [ -d "$d" ] || die "wave $wave not initialized — run: fleet.sh init $wave"
  : > "$d/expected-pods"
  for p in "$@"; do printf '%s\n' "$p" >> "$d/expected-pods"; done
  printf 'fleet: wave %s expects %s pod(s): %s\n' "$wave" "$#" "$*"
}

# A pod handoff is the file .orchestration/wave-<id>/pod-<p>-handoff.md.
# Architects write it when their pod handoff to the master is complete.
cmd_check() {
  [ $# -eq 1 ] || die "check needs <wave-id>"
  wave="$1"; d="$(wave_dir "$wave")"
  [ -d "$d" ] || die "wave $wave not initialized"
  exp="$d/expected-pods"
  [ -f "$exp" ] || die "no expected pods declared — run: fleet.sh expect $wave <pod>..."
  printf '=== wave %s integration readiness ===\n' "$wave"
  missing=""
  found=""
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -f "$d/pod-$p-handoff.md" ]; then
      found="$found $p"
    else
      missing="$missing $p"
    fi
  done < "$exp"
  printf '  expected pods: %s\n' "$(tr '\n' ' ' < "$exp")"
  printf '  handoffs found:%s\n' "${found:- (none)}"
  if [ -n "$missing" ]; then
    printf '  MISSING:%s  — DO NOT integrate; silent gap detected\n' "$missing"
    exit 2
  fi
  printf '  all expected pod handoffs present — safe to review for integration\n'
}

# Scan every pod board and print only entries whose NEXT_CHECK_IN is in the past.
# Deterministic; the monitor session runs this on a timer. exit 3 if any overdue.
# Only ISO-8601 timestamps are compared (HH:MM is ambiguous without a date here);
# the TypeScript watchdog in the extension handles HH:MM. This CLI is a convenience.
cmd_watch() {
  [ $# -eq 1 ] || die "watch needs <wave-id>"
  wave="$1"; d="$(wave_dir "$wave")"
  [ -d "$d" ] || die "wave $wave not initialized"
  now_epoch=$(date +%s)
  found=0
  printf '=== watchdog wave %s (now=%s) ===\n' "$wave" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for board in "$d"/pod-*-kanban.md; do
    [ -f "$board" ] || continue
    pod=$(basename "$board" | sed 's/^pod-//; s/-kanban\.md$//')
    # table rows: split on |, look at last non-empty column (NEXT_CHECK_IN) and col 2 (state/status)
    while IFS= read -r line; do
      case "$line" in
        \|*\|)
          # skip separator rows
          case "$line" in *---*) continue ;; esac
          id=$(printf '%s' "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$2); print $2}')
          state=$(printf '%s' "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}')
          nci=$(printf '%s' "$line" | awk -F'|' '{n=NF-1; gsub(/^ +| +$/,"",$n); print $n}')
          # header rows
          case "$id" in AGENT|"TASK ID") continue ;; esac
          case "$state" in OFFLINE|DONE|BACKLOG) continue ;; esac
          # only compare ISO timestamps (contain 'T' and '-')
          case "$nci" in
            *-*T*)
              due_epoch=$(iso_to_epoch "$nci")
              [ -n "$due_epoch" ] || continue
              if [ "$now_epoch" -gt "$due_epoch" ]; then
                over=$(( (now_epoch - due_epoch) / 60 ))
                printf '  OVERDUE  %-4s %-16s [%s]  NEXT_CHECK_IN %s  (%sm)\n' "$pod" "$id" "$state" "$nci" "$over"
                found=1
              fi
              ;;
          esac
          ;;
      esac
    done < "$board"
  done
  if [ "$found" -eq 0 ]; then
    printf '  all NEXT_CHECK_IN fresh (ISO-dated entries)\n'
    return 0
  fi
  printf '  — audit overdue entries via each pod architect; mark STALE if unrefreshable\n'
  exit 3
}

# Portable ISO-8601 (UTC 'Z') to epoch seconds; empty on failure.
iso_to_epoch() {
  # try GNU date, then BSD date
  date -u -d "$1" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null || true
}

cmd_status() {
  [ $# -eq 1 ] || die "status needs <wave-id>"
  wave="$1"; d="$(wave_dir "$wave")"
  [ -d "$d" ] || die "wave $wave not initialized"
  printf '=== wave %s ===\n' "$wave"
  printf -- '--- boards ---\n'
  ls -1 "$d"/*.md 2>/dev/null | sed 's/^/  /' || printf '  (none)\n'
  printf -- '--- worktrees ---\n'
  git worktree list | grep "wave-$wave" | sed 's/^/  /' || printf '  (none)\n'
  printf -- '--- pods (expected vs handoffs) ---\n'
  exp="$d/expected-pods"
  if [ -f "$exp" ]; then
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      if [ -f "$d/pod-$p-handoff.md" ]; then
        printf '  %-12s HANDOFF\n' "$p"
      else
        printf '  %-12s pending\n' "$p"
      fi
    done < "$exp"
  else
    printf '  (no expected pods declared — run: fleet.sh expect %s <pod>...)\n' "$wave"
  fi
  printf -- '--- test registry ---\n'
  reg="$d/test-registry.tsv"
  if [ -f "$reg" ]; then
    awk -F'\t' 'NR==1{next} {printf "  %-16s %-8s %s\n", $1, $2, $9}' "$reg"
    n=$(( $(wc -l < "$reg") - 1 ))
    printf '  (%s recorded executions)\n' "$n"
  fi
}

# ---------------------------------------------------------------------------

[ $# -ge 1 ] || die "usage: fleet.sh <init|expect|check|watch|pod|worktree|overlap|test-key|test-check|test-record|status> ..."
sub="$1"; shift
case "$sub" in
  init)         cmd_init "$@" ;;
  expect)       cmd_expect "$@" ;;
  check)        cmd_check "$@" ;;
  watch)        cmd_watch "$@" ;;
  pod)          cmd_pod "$@" ;;
  worktree)     cmd_worktree "$@" ;;
  overlap)      cmd_overlap "$@" ;;
  test-key)     cmd_test_key "$@" ;;
  test-check)   cmd_test_check "$@" ;;
  test-record)  cmd_test_record "$@" ;;
  status)       cmd_status "$@" ;;
  *)            die "unknown subcommand '$sub'" ;;
esac
