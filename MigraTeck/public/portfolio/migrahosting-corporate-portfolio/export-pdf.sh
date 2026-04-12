#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_PATH="${1:-$ROOT_DIR/MigraHosting-Corporate-Portfolio.pdf}"
HTML_PATH="$ROOT_DIR/index.html"
PLAYWRIGHT_PYTHON="/home/bonex/workspace/active/MigraTeck-Ecosystem/dev/New Migra-Panel/.venv-playwright/bin/python"

if [[ ! -x "$PLAYWRIGHT_PYTHON" ]]; then
  echo "Playwright Python runtime not found at: $PLAYWRIGHT_PYTHON" >&2
  exit 1
fi

"$PLAYWRIGHT_PYTHON" - "$HTML_PATH" "$OUTPUT_PATH" <<'PY'
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


html_path = Path(sys.argv[1]).resolve()
output_path = Path(sys.argv[2]).resolve()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.goto(html_path.as_uri(), wait_until="networkidle")
    page.pdf(
        path=str(output_path),
        format="A4",
        landscape=True,
        print_background=True,
        margin={
            "top": "10mm",
            "right": "10mm",
            "bottom": "10mm",
            "left": "10mm",
        },
    )
    browser.close()

print(f"PDF written to {output_path}")
PY