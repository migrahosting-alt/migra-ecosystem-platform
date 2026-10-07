#!/usr/bin/env bash
set -euo pipefail

S3_HOSTNAME="${MIGRATECK_S3_HOSTNAME:-s3.migradrive.com}"
INTERNAL_EDGE_IP="${MIGRATECK_S3_INTERNAL_IP:-10.10.0.2}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
START_MARKER="# MIGRATECK SPLIT DNS BEGIN"
END_MARKER="# MIGRATECK SPLIT DNS END"
MODE="${1:-apply}"

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

pass() {
  printf '[PASS] %s\n' "$1"
}

validate_inputs() {
  [[ "$S3_HOSTNAME" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Invalid S3 hostname: $S3_HOSTNAME"
  [[ "$INTERNAL_EDGE_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "Invalid IPv4 address: $INTERNAL_EDGE_IP"

  IFS='.' read -r a b c d <<<"$INTERNAL_EDGE_IP"
  for octet in "$a" "$b" "$c" "$d"; do
    (( octet >= 0 && octet <= 255 )) || fail "Invalid IPv4 address: $INTERNAL_EDGE_IP"
  done
}

check_mapping() {
  grep -Fqx "$START_MARKER" "$HOSTS_FILE" || fail "Split-DNS marker is missing from $HOSTS_FILE"
  grep -Fqx "$INTERNAL_EDGE_IP $S3_HOSTNAME" "$HOSTS_FILE" || fail "$S3_HOSTNAME is not pinned to $INTERNAL_EDGE_IP in $HOSTS_FILE"
  grep -Fqx "$END_MARKER" "$HOSTS_FILE" || fail "Split-DNS end marker is missing from $HOSTS_FILE"

  if [[ "$HOSTS_FILE" == "/etc/hosts" ]]; then
    resolved="$(getent ahostsv4 "$S3_HOSTNAME" | awk 'NR==1 {print $1}')"
    [[ "$resolved" == "$INTERNAL_EDGE_IP" ]] || fail "$S3_HOSTNAME resolves to ${resolved:-nothing}, expected $INTERNAL_EDGE_IP"
    pass "$S3_HOSTNAME resolves internally to $INTERNAL_EDGE_IP"
  else
    pass "Mapping is present in $HOSTS_FILE"
  fi
}

apply_mapping() {
  [[ -e "$HOSTS_FILE" ]] || fail "$HOSTS_FILE does not exist"
  [[ -w "$HOSTS_FILE" ]] || fail "$HOSTS_FILE is not writable; run as root"

  temp="$(mktemp)"
  trap 'rm -f "$temp"' EXIT

  awk -v start="$START_MARKER" -v end="$END_MARKER" '
    $0 == start { skipping=1; next }
    $0 == end { skipping=0; next }
    !skipping { print }
  ' "$HOSTS_FILE" > "$temp"

  while [[ -s "$temp" ]] && [[ "$(tail -c 1 "$temp" | wc -l)" -eq 0 ]]; do
    printf '\n' >> "$temp"
  done

  {
    printf '%s\n' "$START_MARKER"
    printf '%s %s\n' "$INTERNAL_EDGE_IP" "$S3_HOSTNAME"
    printf '%s\n' "$END_MARKER"
  } >> "$temp"

  cat "$temp" > "$HOSTS_FILE"
  pass "Configured $S3_HOSTNAME -> $INTERNAL_EDGE_IP in $HOSTS_FILE"
  check_mapping
}

validate_inputs

case "$MODE" in
  apply)
    apply_mapping
    ;;
  check)
    check_mapping
    ;;
  *)
    fail "Usage: $0 [apply|check]"
    ;;
esac
