#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-root@nginx-proxy-core}"
REMOTE_PUBLIC_ROOT="${REMOTE_PUBLIC_ROOT:-/var/www/migramail.com/public}"
REMOTE_TEMPLATE="${REMOTE_TEMPLATE:-${REMOTE_PUBLIC_ROOT}/snappymail/v/2.38.2/app/templates/Index.html}"
REMOTE_STATIC_ROOT="${REMOTE_STATIC_ROOT:-${REMOTE_PUBLIC_ROOT}/snappymail/v/2.38.2/static}"
LOCAL_PUBLIC_ROOT="${LOCAL_PUBLIC_ROOT:-${ROOT_DIR}/MigraMail/apps/migramail-web/frontend/public}"
SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=12
)

say() {
  echo "[$(date +"%H:%M:%S")] $*"
}

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 2
  fi
}

require_file "${LOCAL_PUBLIC_ROOT}/apple-touch-icon.png"
require_file "${LOCAL_PUBLIC_ROOT}/favicon.ico"
require_file "${LOCAL_PUBLIC_ROOT}/robots.txt"
require_file "${LOCAL_PUBLIC_ROOT}/site.webmanifest"
require_file "${LOCAL_PUBLIC_ROOT}/sitemap.xml"
require_file "${LOCAL_PUBLIC_ROOT}/brand/migra-logo-192.png"
require_file "${LOCAL_PUBLIC_ROOT}/brand/migra-logo-512.png"
require_file "${LOCAL_PUBLIC_ROOT}/brand/favicon.svg"
require_file "${LOCAL_PUBLIC_ROOT}/brand/official/migramail-mm.png"
require_file "${LOCAL_PUBLIC_ROOT}/support/index.html"

legacy_template_exists() {
  ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "test -f '${REMOTE_TEMPLATE}'"
}

say "Backing up live SnappyMail template on ${REMOTE_HOST}..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "set -euo pipefail; mkdir -p '${REMOTE_PUBLIC_ROOT}/brand/official' '${REMOTE_PUBLIC_ROOT}/support' '${REMOTE_STATIC_ROOT}'"
if legacy_template_exists; then
  ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "cp -a '${REMOTE_TEMPLATE}' '${REMOTE_TEMPLATE}.bak.$(date -u +%Y%m%dT%H%M%SZ)'"
else
  say "Legacy SnappyMail template not present on ${REMOTE_HOST}; skipping template backup."
fi

say "Syncing MigraMail crawler assets to ${REMOTE_HOST}..."
scp "${SSH_OPTS[@]}" \
  "${LOCAL_PUBLIC_ROOT}/apple-touch-icon.png" \
  "${LOCAL_PUBLIC_ROOT}/favicon.ico" \
  "${LOCAL_PUBLIC_ROOT}/robots.txt" \
  "${LOCAL_PUBLIC_ROOT}/site.webmanifest" \
  "${LOCAL_PUBLIC_ROOT}/sitemap.xml" \
  "${LOCAL_PUBLIC_ROOT}/brand/migra-logo-192.png" \
  "${LOCAL_PUBLIC_ROOT}/brand/migra-logo-512.png" \
  "${LOCAL_PUBLIC_ROOT}/brand/favicon.svg" \
  "${LOCAL_PUBLIC_ROOT}/brand/official/migramail-mm.png" \
  "${REMOTE_HOST}:${REMOTE_PUBLIC_ROOT}/"

scp "${SSH_OPTS[@]}" \
  "${LOCAL_PUBLIC_ROOT}/support/index.html" \
  "${REMOTE_HOST}:${REMOTE_PUBLIC_ROOT}/support/index.html"

ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "mkdir -p '${REMOTE_PUBLIC_ROOT}/brand' '${REMOTE_PUBLIC_ROOT}/brand/official' '${REMOTE_PUBLIC_ROOT}/support' && mv '${REMOTE_PUBLIC_ROOT}/migramail-mm.png' '${REMOTE_PUBLIC_ROOT}/brand/official/migramail-mm.png' && mv '${REMOTE_PUBLIC_ROOT}/migra-logo-192.png' '${REMOTE_PUBLIC_ROOT}/brand/migra-logo-192.png' && mv '${REMOTE_PUBLIC_ROOT}/migra-logo-512.png' '${REMOTE_PUBLIC_ROOT}/brand/migra-logo-512.png' && mv '${REMOTE_PUBLIC_ROOT}/favicon.svg' '${REMOTE_PUBLIC_ROOT}/brand/favicon.svg' && install -m 0644 '${REMOTE_PUBLIC_ROOT}/apple-touch-icon.png' '${REMOTE_STATIC_ROOT}/apple-touch-icon.png' && install -m 0644 '${REMOTE_PUBLIC_ROOT}/favicon.ico' '${REMOTE_STATIC_ROOT}/favicon.ico' && install -m 0644 '${REMOTE_PUBLIC_ROOT}/brand/favicon.svg' '${REMOTE_STATIC_ROOT}/favicon.svg' && install -m 0644 '${REMOTE_PUBLIC_ROOT}/brand/migra-logo-192.png' '${REMOTE_STATIC_ROOT}/android-icon.png' && install -m 0644 '${REMOTE_PUBLIC_ROOT}/brand/migra-logo-512.png' '${REMOTE_STATIC_ROOT}/logo-512.png' && chown www-data:www-data '${REMOTE_PUBLIC_ROOT}/brand/official/migramail-mm.png' '${REMOTE_PUBLIC_ROOT}/brand/migra-logo-192.png' '${REMOTE_PUBLIC_ROOT}/brand/migra-logo-512.png' '${REMOTE_PUBLIC_ROOT}/brand/favicon.svg' '${REMOTE_PUBLIC_ROOT}/apple-touch-icon.png' '${REMOTE_PUBLIC_ROOT}/favicon.ico' '${REMOTE_PUBLIC_ROOT}/robots.txt' '${REMOTE_PUBLIC_ROOT}/site.webmanifest' '${REMOTE_PUBLIC_ROOT}/sitemap.xml' '${REMOTE_PUBLIC_ROOT}/support/index.html' '${REMOTE_STATIC_ROOT}/apple-touch-icon.png' '${REMOTE_STATIC_ROOT}/favicon.ico' '${REMOTE_STATIC_ROOT}/favicon.svg' '${REMOTE_STATIC_ROOT}/android-icon.png' '${REMOTE_STATIC_ROOT}/logo-512.png'"

if legacy_template_exists; then
say "Patching live MigraMail SnappyMail head template..."
if ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "grep -q '<meta name=\"application-name\" content=\"MigraMail\">' '${REMOTE_TEMPLATE}' && grep -q '<meta name=\"apple-mobile-web-app-title\" content=\"MigraMail\">' '${REMOTE_TEMPLATE}' && grep -q '<link rel=\"manifest\" href=\"/site.webmanifest\">' '${REMOTE_TEMPLATE}' && ! grep -q '/snappymail/v/2.38.2/static/manifest.json' '${REMOTE_TEMPLATE}'"; then
  say "Live SnappyMail head already branded; skipping template rewrite."
else
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "python3 - <<'PY'
from pathlib import Path

path = Path('${REMOTE_TEMPLATE}')
text = path.read_text()
replacement = '''<meta name="robots" content="noindex,nofollow,noodp">
        <meta name="application-name" content="MigraMail">
  <meta name="apple-mobile-web-app-title" content="MigraMail">
        <meta name="description" content="MigraMail secure webmail for custom-domain email hosting powered by MigraTeck.">
        <meta name="theme-color" content="#0a0a1a">
        <meta property="og:title" content="MigraMail">
        <meta property="og:description" content="Secure custom-domain webmail powered by MigraTeck with IMAP, SMTP, and branded inbox access.">
        <meta property="og:type" content="website">
        <meta property="og:url" content="https://migramail.com">
        <meta property="og:site_name" content="MigraMail">
        <meta property="og:image" content="https://migramail.com/brand/official/migramail-mm.png">
        <meta property="og:image:alt" content="MigraMail official logo">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="MigraMail">
        <meta name="twitter:description" content="Secure custom-domain webmail powered by MigraTeck with IMAP, SMTP, and branded inbox access.">
        <meta name="twitter:image" content="https://migramail.com/brand/official/migramail-mm.png">
        <meta name="twitter:image:alt" content="MigraMail official logo">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">
        <link rel="manifest" href="/site.webmanifest">
        <link rel="canonical" href="https://migramail.com">
        <meta name="theme-color" content="#0a0a1a">
        <title>MigraMail</title>'''
start = text.find('<meta name="robots" content="noindex,nofollow,noodp">')
end = text.find('</title>', start)
if start == -1 or end == -1:
    raise SystemExit('failed to normalize MigraMail SnappyMail head block')
new_text = text[:start] + replacement + text[end + len('</title>'):]
new_text = new_text.replace(
    '<link rel="manifest" href="/snappymail/v/2.38.2/static/manifest.json">',
    '<link rel="manifest" href="/site.webmanifest">'
)
path.write_text(new_text)
PY"
fi

say "Normalizing any remaining legacy manifest pointers..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "python3 - <<'PY'
from pathlib import Path

path = Path('${REMOTE_TEMPLATE}')
text = path.read_text()
text = text.replace(
  '<link rel="manifest" href="/snappymail/v/2.38.2/static/manifest.json">',
  '<link rel="manifest" href="/site.webmanifest">'
)
text = text.replace(
  '<link rel="manifest" href="{{BaseAppManifestLink}}">',
  '<link rel="manifest" href="/site.webmanifest">'
)
text = text.replace('{{BaseAppManifestLink}}', '/site.webmanifest')
path.write_text(text)
PY"

say "Clearing SnappyMail host cache..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "find '${REMOTE_PUBLIC_ROOT}/data/_data_/migramail.com/cache' -type f -delete"
else
  say "Legacy SnappyMail template not present on ${REMOTE_HOST}; skipping template rewrite and cache clear."
fi

say "Validating live MigraMail head markers..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "curl -s https://migramail.com | grep -o 'og:image\\|twitter:image\\|canonical\\|application-name\\|apple-mobile-web-app-title\\|robots\\|MigraMail' | sort | uniq -c"

say "Validating legacy static icon endpoints..."
ssh "${SSH_OPTS[@]}" "${REMOTE_HOST}" "file '${REMOTE_STATIC_ROOT}/apple-touch-icon.png' '${REMOTE_STATIC_ROOT}/android-icon.png' '${REMOTE_STATIC_ROOT}/logo-512.png' '${REMOTE_STATIC_ROOT}/favicon.ico' '${REMOTE_STATIC_ROOT}/favicon.svg' | sed -n '1,20p'"

say "✅ MigraMail live branding/SEO sync complete."
