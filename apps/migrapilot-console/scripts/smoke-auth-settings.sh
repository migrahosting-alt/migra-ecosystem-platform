#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MIGRAPILOT_CONSOLE_BASE_URL:-http://127.0.0.1:3401}"
ADMIN_USER="${MIGRAPILOT_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${MIGRAPILOT_ADMIN_PASSWORD:-change-me-now}"
COOKIE_JAR="${MIGRAPILOT_SMOKE_COOKIE_JAR:-/tmp/migrapilot-console-smoke.cookies.txt}"

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

expect_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$label (expected=$expected actual=$actual)"
  fi
  echo "[OK] $label => $actual"
}

echo "[INFO] Running MigraPilot console auth/settings smoke against $BASE_URL"
rm -f "$COOKIE_JAR"

unauth_console_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/console")"
expect_eq "$unauth_console_status" "307" "Unauthenticated /console redirects"

unauth_console_location="$(curl -sSI "$BASE_URL/console" | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r')"
[[ "$unauth_console_location" == /login* ]] || fail "Redirect location must start with /login (actual=$unauth_console_location)"
echo "[OK] Redirect location => $unauth_console_location"

unauth_settings_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/chat/settings")"
expect_eq "$unauth_settings_status" "401" "Unauthenticated settings API blocked"

bad_login_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/login" -H 'content-type: application/json' --data "{\"username\":\"$ADMIN_USER\",\"password\":\"wrong\"}")"
expect_eq "$bad_login_status" "401" "Bad credential login blocked"

good_login_status="$(curl -sS -c "$COOKIE_JAR" -o /tmp/migrapilot-login.json -w '%{http_code}' -X POST "$BASE_URL/api/auth/login" -H 'content-type: application/json' --data "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")"
expect_eq "$good_login_status" "200" "Valid login accepted"

auth_console_status="$(curl -sS -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' "$BASE_URL/console")"
auth_console_location="$(curl -sSI -b "$COOKIE_JAR" "$BASE_URL/console" | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r')"
if [[ "$auth_console_status" == "401" ]]; then
  fail "Authenticated /console should not be unauthorized"
fi
if [[ "$auth_console_status" == "307" && "$auth_console_location" == /login* ]]; then
  fail "Authenticated /console should not redirect to login"
fi
if [[ "$auth_console_status" != "200" ]]; then
  fail "Authenticated /console must render successfully (expected=200 actual=$auth_console_status)"
fi
echo "[OK] Authenticated /console rendered successfully => status=$auth_console_status"

save_payload='{"defaultMode":"execute-t2","provider":"sonnet","model":"claude-sonnet-4-20250514"}'
save_settings="$(curl -sS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/chat/settings" -H 'content-type: application/json' --data "$save_payload")"
read_settings="$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/chat/settings")"

echo "$save_settings" | grep -q '"ok":true' || fail "Save settings response not ok"
echo "$read_settings" | grep -q '"ok":true' || fail "Read settings response not ok"
echo "$read_settings" | grep -q '"defaultMode":"execute-t2"' || fail "defaultMode not persisted"
echo "$read_settings" | grep -q '"provider":"sonnet"' || fail "provider not persisted"

echo "[OK] Settings persisted and readable"

logout_status="$(curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/logout")"
expect_eq "$logout_status" "200" "Logout accepted"

after_logout_status="$(curl -sS -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' "$BASE_URL/api/chat/settings")"
expect_eq "$after_logout_status" "401" "Protected API blocked after logout"

echo "[PASS] MigraPilot console auth/settings smoke complete"
