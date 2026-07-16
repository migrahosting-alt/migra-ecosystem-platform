#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STRICT_MODE=0

if [[ "${1:-}" == "--strict" ]]; then
	STRICT_MODE=1
fi

ALLOWED_ROOT_MARKDOWN=(
	"CANONICAL_PATHS.md"
	"INFRA_SOURCE_OF_TRUTH.md"
	"SECRETS_SOURCE_OF_TRUTH.md"
	"MIGRAWEB_COPILOT_RULES.md"
	"MIGRA_EMAIL_NAMING.ix.md"
	"MIGRA_GUARDIAN_MASTER.ix.md"
	"MIGRAMAIL_UI_BRANDING.ix.md"
)

cd "$ROOT_DIR"

join_by_regex() {
	local delimiter="$1"
	shift
	local result=""
	local item
	for item in "$@"; do
		if [[ -n "$result" ]]; then
			result+="$delimiter"
		fi
		result+="$item"
	done
	printf '%s' "$result"
}

allowed_root_markdown_regex="$(join_by_regex '|' "${ALLOWED_ROOT_MARKDOWN[@]}")"

mapfile -t root_markdown_files < <(find . -maxdepth 1 -type f -name '*.md' -printf '%f\n' | sort)
# Guard the empty case: printf on an empty array emits one blank line, which
# would be miscounted as an "unexpected" file (a phantom violation on clean trees).
unexpected_root_markdown=()
if (( ${#root_markdown_files[@]} > 0 )); then
	mapfile -t unexpected_root_markdown < <(printf '%s\n' "${root_markdown_files[@]}" | grep -Ev "^(${allowed_root_markdown_regex})$" || true)
fi
mapfile -t root_screenshots_archives < <(find . -maxdepth 1 -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' -o -name '*.zip' -o -name '*.tar.gz' -o -name '*.tgz' \) -printf '%f\n' | sort)
mapfile -t root_odd_files < <(find . -maxdepth 1 -type f \( -name '*.sh' -o -name '*.js' -o -name '*.ts' -o -name 'curl' -o -name 'node' -o -name 'done' -o -name 'd' \) -printf '%f\n' | sort)
mapfile -t flat_report_files < <(find docs/reports -maxdepth 1 -type f -name '*.md' ! -name 'README.md' -printf '%f\n' | sort)

echo "Workspace root audit: $ROOT_DIR"
echo

echo "Counts"
printf '  root files: '
find . -maxdepth 1 -type f | wc -l
printf '  root dirs: '
find . -maxdepth 1 -mindepth 1 -type d | wc -l
printf '  root markdown: '
find . -maxdepth 1 -type f -name '*.md' | wc -l
printf '  root screenshots: '
find . -maxdepth 1 -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' \) | wc -l
printf '  root archives: '
find . -maxdepth 1 -type f \( -name '*.zip' -o -name '*.tar.gz' -o -name '*.tgz' \) | wc -l
echo

echo "Top-level markdown files"
printf '%s\n' "${root_markdown_files[@]}"
echo

echo "Top-level screenshots and archives"
printf '%s\n' "${root_screenshots_archives[@]}"
echo

echo "Top-level scripts and odd files"
printf '%s\n' "${root_odd_files[@]}"
echo

echo "Policy checks"
printf '  unexpected root markdown: %s\n' "${#unexpected_root_markdown[@]}"
printf '  root screenshots/archives: %s\n' "${#root_screenshots_archives[@]}"
printf '  root odd files: %s\n' "${#root_odd_files[@]}"
printf '  flat docs/reports markdown: %s\n' "${#flat_report_files[@]}"
echo

if (( ${#unexpected_root_markdown[@]} > 0 )); then
	echo "Unexpected root markdown"
	printf '%s\n' "${unexpected_root_markdown[@]}"
	echo
fi

if (( ${#flat_report_files[@]} > 0 )); then
	echo "Flat docs/reports markdown"
	printf '%s\n' "${flat_report_files[@]}"
	echo
fi

if (( STRICT_MODE == 1 )); then
	violations=0
	violations=$((violations + ${#unexpected_root_markdown[@]}))
	violations=$((violations + ${#root_screenshots_archives[@]}))
	violations=$((violations + ${#root_odd_files[@]}))
	violations=$((violations + ${#flat_report_files[@]}))

	if (( violations > 0 )); then
		echo "STRICT CHECK FAILED: $violations policy violation(s) found."
		exit 1
	fi

	echo "STRICT CHECK PASSED: no root/report policy violations found."
fi
