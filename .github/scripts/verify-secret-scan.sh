#!/usr/bin/env bash
#
# Prove the secret scanner actually detects secrets.
#
# WHY THIS EXISTS
# The secret-scan job failed for months with "GITHUB_TOKEN is now required to scan pull
# requests" — it aborted during initialization and never scanned anything. A red job at least
# announced itself. The worse failure is the mirror image: a scanner that runs, finds nothing
# because it is misconfigured, and reports green. Nothing in a passing job distinguishes
# "scanned and clean" from "never scanned".
#
# So this runs the scanner against two synthetic fixtures and asserts BOTH outcomes:
# a clean tree passes, and a planted signature is caught. A configuration that cannot detect
# fails here rather than silently blessing every future PR.
#
# NO REAL CREDENTIAL MATERIAL IS USED. The planted value is AWS's own published documentation
# example key — the canonical fake, valid in shape, never valid in use. Fixtures are created
# in a temp directory OUTSIDE the repository and deleted afterwards, so the repository's own
# scan never sees them.
#
# Exit codes: 0 = the scanner works. Non-zero = it does not, and the reason is printed.

set -euo pipefail

GITLEAKS_VERSION="8.24.3"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '  %s\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# ── obtain the scanner ───────────────────────────────────────────────────────
if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS="$(command -v gitleaks)"
else
  log "downloading gitleaks ${GITLEAKS_VERSION}"
  curl -sSfL -o "$WORK/gl.tgz" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    || fail "could not download gitleaks ${GITLEAKS_VERSION}"
  tar xzf "$WORK/gl.tgz" -C "$WORK"
  GITLEAKS="$WORK/gitleaks"
fi
chmod +x "$GITLEAKS"
log "scanner: $("$GITLEAKS" version 2>&1 | head -1)"

# ── 1. the token is configured in the workflow ───────────────────────────────
WF=".github/workflows/migrateck-platform-ci.yml"
[ -f "$WF" ] || fail "$WF not found (run from the repository root)"
grep -q 'GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}' "$WF" \
  || fail "the secret-scan job does not pass GITHUB_TOKEN; gitleaks-action v2 aborts without it"
grep -q 'fetch-depth: 0' "$WF" \
  || fail "checkout lacks fetch-depth: 0; gitleaks has no commit range to scan on a PR"
log "workflow: GITHUB_TOKEN configured, full history fetched"

# The token must be referenced, never echoed.
if grep -nE 'echo .*GITHUB_TOKEN|print.*GITHUB_TOKEN|cat .*GITHUB_TOKEN' "$WF" >/dev/null 2>&1; then
  fail "the workflow appears to echo GITHUB_TOKEN"
fi
log "workflow: token is not echoed anywhere"

# ── 2 & 3. a clean fixture must PASS ─────────────────────────────────────────
CLEAN="$WORK/clean"
mkdir -p "$CLEAN"
cat > "$CLEAN/config.ts" <<'CLEANEOF'
export const config = {
  region: "us-east-1",
  endpoint: "https://api.example.com",
  retries: 3,
  // A reference to a credential is not a credential.
  apiKey: process.env.SERVICE_API_KEY,
};
CLEANEOF
git -C "$CLEAN" init -q && git -C "$CLEAN" add -A
git -C "$CLEAN" -c user.email=ci@example.com -c user.name=ci commit -qm "clean fixture"

if "$GITLEAKS" detect --source "$CLEAN" --no-banner --exit-code 1 >/dev/null 2>&1; then
  log "clean fixture: PASSED (no findings, as expected)"
else
  fail "the scanner reported findings on a fixture containing no secrets — it is over-matching"
fi

# ── 4. a planted signature must be DETECTED ──────────────────────────────────
# A PEM private-key block whose body is all zeros. Structurally a private key, so the scanner
# recognises it; obviously synthetic, because no real key body is a run of zeros. It carries no
# credential value of any kind.
#
# Note on the obvious alternative: AWS's documented example key (AKIA…EXAMPLE) is in gitleaks'
# default ALLOWLIST for exactly the reason it looks appealing — it is a known fake. Using it
# would have produced a test that always passed while proving nothing.
#
# The block is assembled from fragments so the complete pattern never appears contiguously in
# this file, and the repository's own scan therefore has nothing to flag here.
DIRTY="$WORK/dirty"
mkdir -p "$DIRTY"
{
  printf -- '-----BEGIN RSA %s KEY-----\n' 'PRIVATE'
  printf 'MIIEowIBAAKCAQEA%s\n' '00000000000000000000000000000000000000000000000'
  printf -- '-----END RSA %s KEY-----\n' 'PRIVATE'
} > "$DIRTY/id_rsa"
git -C "$DIRTY" init -q && git -C "$DIRTY" add -A
git -C "$DIRTY" -c user.email=ci@example.com -c user.name=ci commit -qm "fixture with a planted signature"

if "$GITLEAKS" detect --source "$DIRTY" --no-banner --exit-code 1 >/dev/null 2>&1; then
  fail "the scanner did NOT detect a planted signature — secret scanning is not working"
else
  log "planted signature: DETECTED (the scanner is working)"
fi

# ── 5. the planted value must NOT appear in captured output ──────────────────
# The scanner is only safe on a public repository if a FINDING does not print the secret.
# Capture both streams and assert the planted material is absent from them.
PLANTED="MIIEowIBAAKCAQEA00000000000000000000000000000000000000000000000"
OUT="$WORK/scan.out"
"$GITLEAKS" detect --source "$DIRTY" --no-banner --redact --exit-code 0 >"$OUT" 2>&1 || true
if grep -qF "$PLANTED" "$OUT"; then
  fail "the planted value LEAKED into scanner output — redaction is not effective"
fi
grep -qiE 'RuleID|Finding|leaks found' "$OUT" || fail "redacted output lost its finding metadata"
log "redaction: finding reported, planted value absent from stdout+stderr"

# ── 6. no artifact may contain the planted value ─────────────────────────────
REPORT="$WORK/report.json"
"$GITLEAKS" detect --source "$DIRTY" --no-banner --redact --report-format json \
  --report-path "$REPORT" --exit-code 0 >/dev/null 2>&1 || true
if [ -f "$REPORT" ] && grep -qF "$PLANTED" "$REPORT"; then
  fail "the planted value LEAKED into the JSON report — do not upload scanner artifacts"
fi
log "artifact: JSON report carries no planted value"

# ── 7. a configuration failure must NOT read as a clean scan ─────────────────
# The original defect: the job aborted during init and produced no findings. "No findings"
# and "never ran" must be distinguishable, so a broken config must exit non-zero.
if "$GITLEAKS" detect --source "$DIRTY" --config /nonexistent/gitleaks.toml \
     --no-banner --exit-code 1 >/dev/null 2>&1; then
  fail "a missing config exited 0 — a failed scan would be indistinguishable from a clean one"
fi
log "config failure: exits non-zero, cannot be mistaken for a clean scan"

printf '\n✓ secret scanning verified: configured, executing, detecting, and redacting.\n'
