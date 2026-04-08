#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://call.migrahosting.com}"

log() {
  printf '[migravoice-smoke] %s\n' "$*"
}

fetch_headers() {
  curl -fsSI --max-time 20 "$1"
}

fetch_body() {
  curl -fsS --max-time 20 "$1"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'FAIL: %s\n' "$message" >&2
    exit 1
  fi
}

log "Checking app shell"
html="$(fetch_body "$BASE_URL/")"
assert_contains "$html" '<title>MigraVoice - Enterprise Softphone</title>' 'App shell title mismatch'

log "Checking health endpoint"
health="$(curl -fsS --max-time 20 "$BASE_URL/health")"
assert_contains "$health" 'OK' 'Health endpoint did not return OK'

log "Checking service worker cache policy"
sw_headers="$(fetch_headers "$BASE_URL/sw.js")"
assert_contains "$sw_headers" 'cache-control: no-store' 'sw.js must not be immutable cached'

log "Checking manifest headers"
manifest_headers="$(fetch_headers "$BASE_URL/site.webmanifest")"
assert_contains "$manifest_headers" 'content-type: application/manifest+json' 'Manifest content type mismatch'
assert_contains "$manifest_headers" 'cache-control: no-cache' 'Manifest cache policy mismatch'

log "Checking build metadata"
build_json="$(fetch_body "$BASE_URL/build.json")"
node -e "const data = JSON.parse(process.argv[1]); if (data.app !== 'MigraVoice' || !data.releaseLabel || !data.buildTime) process.exit(1); console.log(data.releaseLabel);" "$build_json"

log "MigraVoice release smoke passed."