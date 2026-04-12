#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./install-migrastacks-pack.sh --wp-path /var/www/html [--network] [--no-backup] [--skip-auto-updates] [--hardening-baseline]

Description:
  Installs the MigraStacks enterprise plugin suite into a WordPress site and validates
  operational CLI checks.

Options:
  --wp-path            Absolute path to WordPress root (contains wp-config.php)
  --network            Activate plugins network-wide on multisite
  --no-backup          Replace existing MigraStacks plugins without creating backups
  --skip-auto-updates  Do not enable plugin auto-updates
  --hardening-baseline Apply enterprise-safe baseline hardening after install
  -h, --help           Show this help
EOF
}

WP_PATH=""
NETWORK_FLAG=""
BACKUP_ENABLED=1
AUTO_UPDATES_ENABLED=1
HARDENING_BASELINE_ENABLED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wp-path)
      WP_PATH="${2:-}"
      shift 2
      ;;
    --network)
      NETWORK_FLAG="--network"
      shift
      ;;
    --no-backup)
      BACKUP_ENABLED=0
      shift
      ;;
    --skip-auto-updates)
      AUTO_UPDATES_ENABLED=0
      shift
      ;;
    --hardening-baseline)
      HARDENING_BASELINE_ENABLED=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$WP_PATH" ]]; then
  echo "Missing required option: --wp-path" >&2
  usage
  exit 1
fi

if [[ ! -f "$WP_PATH/wp-config.php" ]]; then
  echo "Invalid --wp-path: wp-config.php not found in $WP_PATH" >&2
  exit 1
fi

if ! command -v wp >/dev/null 2>&1; then
  echo "wp-cli is required but not found in PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

PLUGINS=(
  "migrastacks-core"
  "migrastacks-security"
  "migrastacks-performance"
  "migrastacks-deliverability"
)

backup_plugin() {
  local plugin="$1"
  local src="$WP_PATH/wp-content/plugins/$plugin"
  local backup_root="$WP_PATH/wp-content/migrastacks-backups/$TIMESTAMP"
  local backup_dst="$backup_root/$plugin"

  if [[ ! -d "$src" ]]; then
    return 0
  fi

  mkdir -p "$backup_root"
  cp -a "$src" "$backup_dst"
}

apply_hardening_baseline() {
  echo "Applying hardening baseline..."

  local default_role
  default_role="$(wp option get default_role --path="$WP_PATH" 2>/dev/null || true)"
  if [[ "$default_role" != "subscriber" ]]; then
    wp option update default_role subscriber --path="$WP_PATH" >/dev/null
    echo "- default_role set to subscriber"
  else
    echo "- default_role already subscriber"
  fi

  local permalink
  permalink="$(wp option get permalink_structure --path="$WP_PATH" 2>/dev/null || true)"
  if [[ -z "$permalink" ]]; then
    wp rewrite structure '/%postname%/' --path="$WP_PATH" >/dev/null
    wp rewrite flush --path="$WP_PATH" >/dev/null || true
    echo "- permalink_structure set to /%postname%/"
  else
    echo "- permalink_structure preserved: $permalink"
  fi

  if wp eval "exit((defined('DISALLOW_FILE_EDIT') && DISALLOW_FILE_EDIT) ? 0 : 1);" --path="$WP_PATH" >/dev/null 2>&1; then
    echo "- DISALLOW_FILE_EDIT is enabled"
  else
    echo "- WARNING: DISALLOW_FILE_EDIT is not enabled in wp-config.php"
  fi
}

echo "Copying MigraStacks plugins into $WP_PATH/wp-content/plugins..."
for plugin in "${PLUGINS[@]}"; do
  src="$SCRIPT_DIR/$plugin"
  dst="$WP_PATH/wp-content/plugins/$plugin"

  if [[ ! -d "$src" ]]; then
    echo "Missing plugin source directory: $src" >&2
    exit 1
  fi

  if [[ $BACKUP_ENABLED -eq 1 ]]; then
    backup_plugin "$plugin"
  fi

  rm -rf "$dst"
  cp -a "$src" "$dst"
done

echo "Activating MigraStacks plugins with wp-cli..."
for plugin in "${PLUGINS[@]}"; do
  wp plugin activate "$plugin" --path="$WP_PATH" $NETWORK_FLAG
done

if [[ $AUTO_UPDATES_ENABLED -eq 1 ]]; then
  echo "Enabling plugin auto-updates..."
  for plugin in "${PLUGINS[@]}"; do
    wp plugin auto-updates enable "$plugin" --path="$WP_PATH"
  done
fi

if [[ $HARDENING_BASELINE_ENABLED -eq 1 ]]; then
  apply_hardening_baseline
fi

echo "Validating active plugin state..."
active_plugins="$(
  {
    wp plugin list --path="$WP_PATH" --status=active --field=name
    wp plugin list --path="$WP_PATH" --status=active-network --field=name
  } | sort -u
)"
for plugin in "${PLUGINS[@]}"; do
  if ! grep -qx "$plugin" <<<"$active_plugins"; then
    echo "Plugin activation check failed for: $plugin" >&2
    exit 1
  fi
done

echo
echo "Running enterprise diagnostics:"
wp migrastacks status --path="$WP_PATH"
echo
wp migrastacks performance status --path="$WP_PATH"
echo
wp migrastacks mail status --path="$WP_PATH"

echo
echo "Installed plugins:"
{
  wp plugin list --path="$WP_PATH" --status=active
  wp plugin list --path="$WP_PATH" --status=active-network
} | grep migrastacks || true

if [[ $BACKUP_ENABLED -eq 1 ]]; then
  echo "Backups (if any existed) stored under: $WP_PATH/wp-content/migrastacks-backups/$TIMESTAMP"
fi

echo "Done."
