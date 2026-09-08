#!/usr/bin/env bash
#
# THE SUITE GATE — run it, and refuse to report a number nobody read.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 WHY THIS EXISTS
#
# Twice in one session a test count was reported that had never been observed.
#
#   1. A count read from a DIRECT invocation of one file, while the suite
#      itself had never loaded that file at all.
#   2. A count reported from a run where `tsc -b` failed, so the suite never
#      executed — the verification command printed nothing, and a number was
#      stated anyway.
#
# The lesson after the first was "the suite gate is the authority". True, and
# insufficient: consulting the gate is worthless if you do not read what it
# says. EMPTY OUTPUT IS NOT A PASSING RESULT.
#
# So this makes reading mechanical. It fails when the build fails, when the
# suite does not finish, when no final count is printed, or when any test
# failed — and it prints exactly one line that is safe to quote.
#
# ─────────────────────────────────────────────────────────────────────────────
#   usage:  docs/migrapilot/suite-gate.sh <app-dir>
#   e.g.    docs/migrapilot/suite-gate.sh apps/brain-service
set -uo pipefail

APP="${1:?usage: suite-gate.sh <app-dir>}"
[ -d "$APP" ] || { echo "GATE ABORTED: no such directory: $APP" >&2; exit 1; }

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

# Not `set -e`: a failing suite is an EXPECTED outcome this script reports on,
# not a crash. The exit code is captured and judged below.
( cd "$APP" && npm test ) >"$OUT" 2>&1
STATUS=$?

# ── 1. did the run even finish? ─────────────────────────────────────────────
# A build failure is the case that produced a false claim: the suite never
# ran, the grep for a count matched nothing, and silence was read as success.
if ! grep -qE '^# tests [0-9]+' "$OUT"; then
  echo "GATE FAILED: the suite printed NO final count." >&2
  echo "  This is the failure mode that produced a false report: no output is not a pass." >&2
  echo "  Last 15 lines:" >&2
  tail -15 "$OUT" | sed 's/^/    /' >&2
  exit 1
fi

TESTS=$(grep -E '^# tests [0-9]+' "$OUT" | tail -1 | awk '{print $3}')
PASS=$(grep -E '^# pass [0-9]+'  "$OUT" | tail -1 | awk '{print $3}')
FAIL=$(grep -E '^# fail [0-9]+'  "$OUT" | tail -1 | awk '{print $3}')
SKIP=$(grep -E '^# skipped [0-9]+' "$OUT" | tail -1 | awk '{print $3}')

for value in "$TESTS" "$PASS" "$FAIL"; do
  if [ -z "$value" ]; then
    echo "GATE FAILED: the summary was incomplete — tests=$TESTS pass=$PASS fail=$FAIL" >&2
    exit 1
  fi
done

# ── 2. the numbers must agree with each other ───────────────────────────────
# A run that reports 2694 tests and 2600 passes with 0 failures is not a pass;
# it is a run that lost tests somewhere, which is exactly what a silently
# unloaded file looks like.
if [ "$FAIL" -ne 0 ]; then
  echo "GATE FAILED: $FAIL test(s) failed." >&2
  grep -E '^not ok' "$OUT" | head -20 | sed 's/^/    /' >&2
  exit 1
fi
if [ "$((PASS + FAIL + ${SKIP:-0}))" -ne "$TESTS" ]; then
  echo "GATE FAILED: the counts do not reconcile — tests=$TESTS pass=$PASS fail=$FAIL skipped=${SKIP:-0}." >&2
  echo "  Tests went missing between collection and reporting." >&2
  exit 1
fi

# ── 3. the runner's own exit code still has to agree ────────────────────────
# A summary can print while the process exits non-zero for another reason.
if [ "$STATUS" -ne 0 ]; then
  echo "GATE FAILED: the suite summarised cleanly but exited $STATUS." >&2
  tail -10 "$OUT" | sed 's/^/    /' >&2
  exit 1
fi

# One line, quotable, and true because it came from a completed run.
echo "SUITE GATE PASSED — $APP: $PASS/$TESTS pass, $FAIL fail, ${SKIP:-0} skipped"
