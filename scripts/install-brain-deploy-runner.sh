#!/usr/bin/env bash
#
# Install the VM111 deploy runner for .github/workflows/deploy-brain.yml.
#
# RUN THIS ON VM111, AS ROOT (or with sudo), ONCE:
#
#   ./install-brain-deploy-runner.sh --token <RUNNER_REGISTRATION_TOKEN>
#
# Get the token from GitHub → Settings → Actions → Runners → New self-hosted
# runner. It is short-lived (~1 hour) and is NOT a personal access token. The
# runner exchanges it for its own credential and the token is never needed again.
#
# 🚨 THE TOKEN IS NEVER ECHOED, LOGGED OR WRITTEN TO A FILE by this script. Pass it
# as an argument on an interactive shell, or via MIGRAPILOT_RUNNER_TOKEN in the
# environment. Do not put it in a commit.
#
# ── THE TRUST BOUNDARY, STATED PLAINLY ─────────────────────────────────────────
#
# A self-hosted runner executes workflow code from the repository on a production
# host. Anyone who can push a workflow change can run code as `migradeploy` on
# VM111. That is inherent to continuous delivery, not a flaw in this script, and it
# is why the runner is an unprivileged user whose ONLY privileged capability is
# invoking one root-owned script it cannot edit.
#
# Idempotent: safe to re-run. It will not re-register a runner that is already
# configured.
#
# © MigraTeck LLC.
set -euo pipefail

RUNNER_VERSION="${RUNNER_VERSION:-2.319.1}"
RUNNER_USER=migradeploy
RUNNER_HOME=/opt/migrapilot/actions-runner
REPO_URL=https://github.com/Migrateck-Ecosystem/migra-ecosystem-platform
LABELS="self-hosted,vm111"
RELEASE_SCRIPT=/opt/migrapilot/bin/brain-release.sh
SUDOERS=/etc/sudoers.d/migradeploy

TOKEN="${MIGRAPILOT_RUNNER_TOKEN:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --version) RUNNER_VERSION="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = "0" ] || { echo "run as root" >&2; exit 2; }
[ -n "$TOKEN" ] || { echo "need --token <registration token> (see the header)" >&2; exit 2; }

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# ── 1. the release script must already be installed, root-owned ────────────────
#
# Checked FIRST because the whole privilege model rests on it: the runner may
# invoke this file, never edit it. If it were writable by the runner, "one
# privileged command" would silently mean "any command".
step "1/6 verify the release script"
[ -f "$RELEASE_SCRIPT" ] || { echo "missing $RELEASE_SCRIPT — install it from scripts/brain-release.sh first" >&2; exit 1; }
owner="$(stat -c '%U:%G' "$RELEASE_SCRIPT")"
[ "$owner" = "root:root" ] || { echo "$RELEASE_SCRIPT is owned by $owner, must be root:root" >&2; exit 1; }
perms="$(stat -c '%a' "$RELEASE_SCRIPT")"
case "$perms" in 755|750|700) : ;; *) echo "$RELEASE_SCRIPT has mode $perms; must not be group/other writable" >&2; exit 1 ;; esac
echo "   ok: $RELEASE_SCRIPT root:root $perms"

step "2/6 service account"
if id -u "$RUNNER_USER" >/dev/null 2>&1; then
  echo "   $RUNNER_USER exists"
else
  useradd --system --create-home --home-dir "/home/$RUNNER_USER" --shell /usr/sbin/nologin "$RUNNER_USER"
  echo "   created $RUNNER_USER (system account, no login shell)"
fi

step "3/6 runner software"
mkdir -p "$RUNNER_HOME"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"
if [ -x "$RUNNER_HOME/config.sh" ]; then
  echo "   runner already unpacked"
else
  tgz="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  curl -sSLo "/tmp/$tgz" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${tgz}"
  tar xzf "/tmp/$tgz" -C "$RUNNER_HOME"
  rm -f "/tmp/$tgz"
  chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"
  echo "   unpacked runner $RUNNER_VERSION"
fi

step "4/6 register with GitHub"
if [ -f "$RUNNER_HOME/.runner" ]; then
  echo "   already registered — leaving it alone"
else
  # The token reaches config.sh through the environment and is never printed.
  # `runuser` rather than `su`/`sudo -u` so no shell parses the value.
  MIGRAPILOT_RUNNER_TOKEN="$TOKEN" runuser -u "$RUNNER_USER" -- \
    env -C "$RUNNER_HOME" ./config.sh \
      --unattended --replace \
      --url "$REPO_URL" \
      --labels "$LABELS" \
      --name vm111 \
      --token "$TOKEN" >/dev/null
  echo "   registered with labels: $LABELS"
fi

# ── 5. exactly one privileged command ──────────────────────────────────────────
#
# Validated with `visudo -c` BEFORE being put in place. A malformed sudoers file
# can lock every user out of sudo on the box, and this one is written by a script.
step "5/6 privilege grant"
tmp="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: %s *\n' "$RUNNER_USER" "$RELEASE_SCRIPT" > "$tmp"
if visudo -cqf "$tmp"; then
  install -o root -g root -m 0440 "$tmp" "$SUDOERS"
  rm -f "$tmp"
  echo "   $SUDOERS -> $RUNNER_USER may run only $RELEASE_SCRIPT"
else
  rm -f "$tmp"
  echo "refusing to install a sudoers file that does not validate" >&2
  exit 1
fi

step "6/6 service"
if systemctl list-units --all --type=service | grep -q 'actions\.runner\.'; then
  echo "   runner service already installed"
else
  ( cd "$RUNNER_HOME" && ./svc.sh install "$RUNNER_USER" >/dev/null && ./svc.sh start >/dev/null )
  echo "   installed and started"
fi

echo
echo "runner status:"
( cd "$RUNNER_HOME" && ./svc.sh status 2>&1 | sed 's/^/   /' | head -6 ) || true
cat <<'DONE'

Done. The pipeline is installed but still DISARMED — deploy-brain.yml only fires on
the ref `deploy/brain`, which does not exist yet.

To arm it, point that ref at a commit whose gap2-repro run went green:

    git branch deploy/brain <green-sha>
    git push origin deploy/brain

From then on, deploying is the act of moving that ref.

To stop deploys from this box at any time, without GitHub:

    echo "paused: <reason>" > /etc/migrapilot/deploy.disabled
DONE
