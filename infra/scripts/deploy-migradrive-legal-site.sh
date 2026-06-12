#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_root="$repo_root/infra/static-sites/migradrive.com/public"
remote_host="${MIGRADRIVE_REMOTE_HOST:-srv1}"
remote_root="${MIGRADRIVE_REMOTE_ROOT:-/srv/web/core/migradrive.com/public}"

if [[ ! -d "$source_root" ]]; then
  echo "Source directory not found: $source_root" >&2
  exit 1
fi

rsync -av \
  "$source_root/privacy" \
  "$source_root/terms" \
  "$source_root/support" \
  "$source_root/signup" \
  "$source_root/robots.txt" \
  "$source_root/sitemap.xml" \
  "$remote_host:$remote_root/"

ssh "$remote_host" "REMOTE_ROOT='$remote_root' python3" <<'PY'
from pathlib import Path
import os
import re

remote_root = Path(os.environ['REMOTE_ROOT'])
index_path = remote_root / 'index.html'
html = index_path.read_text()

footer_start = '<footer class="mt-16 border-t border-slate-800/40 py-8">'
footer_end = '</footer>'
start = html.find(footer_start)
end = html.find(footer_end, start)
if start == -1 or end == -1:
  raise SystemExit('Expected footer block was not found in index.html')

footer = html[start:end + len(footer_end)]
footer = footer.replace(
  '<div class="flex gap-4 text-[11px] text-slate-500">',
  '<div class="flex flex-wrap gap-4 text-[11px] text-slate-500">',
)

console_href = 'href="https://console.migradrive.com"'
console_href_count = html.count(console_href)
if console_href_count < 5:
  raise SystemExit(f'Expected at least 5 public console links in index.html, found {console_href_count}')
html = html.replace(console_href, 'href="/signup/"')

text_replacements = [
  (
    r'(<a href="/signup/" class="cta-btn rounded-full px-4 py-2 text-xs font-semibold text-white">)\s*Open Console(\s*</a>)',
    r'\1Start Free\2',
  ),
  (
    r'(<a href="/signup/" class="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 px-6 py-3\.5 text-sm font-semibold text-slate-200 hover:bg-slate-900">)\s*Open Console(\s*</a>)',
    r'\1Create Account\2',
  ),
  (
    r'(<a href="/signup/" class="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-5 py-2\.5 text-sm font-semibold text-slate-200 hover:bg-slate-900">)\s*Open Web Console(\s*</a>)',
    r'\1Create Account\2',
  ),
  (
    r'(<a href="/signup/" class="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 px-7 py-3\.5 text-sm font-semibold text-slate-200 hover:bg-slate-900">)\s*Open Console(\s*</a>)',
    r'\1Create Account\2',
  ),
]

for pattern, replacement in text_replacements:
  html, count = re.subn(pattern, replacement, html, count=1, flags=re.S)
  if count != 1:
    raise SystemExit(f'Missing expected homepage text pattern: {pattern}')

html = html.replace(
  '<dt class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Console</dt>',
  '<dt class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Signup</dt>',
)
html = html.replace(
  '<dd class="mt-1 text-xs font-medium text-white">console.migradrive.com</dd>',
  '<dd class="mt-1 text-xs font-medium text-white">migradrive.com/signup</dd>',
)

if 'href="/signup/"' not in footer:
  footer = footer.replace(
    '<a href="/docs/" class="hover:text-slate-300">Docs</a>',
    '<a href="/signup/" class="hover:text-slate-300">Signup</a>\n            <a href="/privacy" class="hover:text-slate-300">Privacy</a>\n            <a href="/terms" class="hover:text-slate-300">Terms</a>\n            <a href="/docs/" class="hover:text-slate-300">Docs</a>',
  )

if 'mailto:support@migradrive.com' not in footer:
  footer = footer.replace(
    '<a href="/download/" class="hover:text-slate-300">Download</a>',
    '<a href="/download/" class="hover:text-slate-300">Download</a>\n            <a href="mailto:support@migradrive.com" class="hover:text-slate-300">Support</a>',
  )

html = html[:start] + footer + html[end + len(footer_end):]
html = html.replace('support@migrateck.com', 'support@migradrive.com')
index_path.write_text(html)
PY

echo "Migradrive legal pages deployed to $remote_host:$remote_root"
