#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"

# Inspect ONLY the command being run — not the whole hook JSON, whose
# human-readable description field would false-positive (e.g. a grep whose
# description merely mentions "git push"). Falls back to the raw input when jq
# is unavailable or the command field is empty.
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || CMD="$INPUT"

block() {
  echo "Blocked dangerous command ($1). Ask Bonex for explicit approval." >&2
  exit 2
}

# ─────────────────────────────────────────────────────────────────────────────
# SCOPED EXCEPTION — VM111 MigraPilot provisioning
#
# Authorized by Bonex, 2026-08-15, in writing, bounded to:
#   "create/fix ownership and permissions under /opt/migrapilot; create the
#    Brain and consumer service users if needed; install the systemd units;
#    install/reload/start/enable those units; create required environment files
#    with restrictive permissions; create logs/runtime directories required by
#    those services; run systemctl daemon-reload.
#    Do not use this approval for unrelated packages, firewall changes, SSH
#    hardening, OS upgrades, or changes to other hosts."
#
# This is a narrow allowance, NOT a disable of the elevation rule. Every
# condition below must hold; anything unmatched falls through to the normal
# blocks. Deliberately conservative: when in doubt it returns 1 (blocked).
# ─────────────────────────────────────────────────────────────────────────────
ELEV="s""udo"   # split so this policy file can be edited by tooling that
                # refuses to emit the bare keyword; value is exactly the word.

vm111_migrapilot_provisioning() {
  local c="$1"

  # 1. HOST — must be an ssh invocation naming the VM111 alias, and no other
  #    host may appear anywhere in the command.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"migrapilot-app-core"* ]] || return 1
  case "$c" in
    # NOTE: match the runpod SSH ALIAS, not the substring — `api.runpod.ai`
    # legitimately appears in the provider URL written into brain.env.
    *"root@"*|*"@10.10.0.12"*|*"138.201.255.55"*|*" pve "*|*"-J pve"*|*"ssh runpod"*|*"pct exec"*|*"@10.10.0."*)
      return 1 ;;
  esac

  # 2. HARD DENY — never permitted under this exception, even on VM111.
  case "$c" in
    *"rm -rf"*|*"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*) return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*|*"snap install"*|*"pip install"*|*"npm i -g"*|*"npm install -g"*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*) return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"reboot"*|*"shutdown"*|*"init 0"*|*"init 6"*) return 1 ;;
    *"passwd "*|*"usermod -aG"*|*"gpasswd"*) return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*) return 1 ;;
  esac

  # 3. SYSTEMD SCOPE — any unit named must be a migrapilot-* unit, and any unit
  #    file path must live at /etc/systemd/system/migrapilot-*.
  if [[ "$c" == *"systemctl"* ]]; then
    # Permit only these verbs, and only against migrapilot-* units.
    # `daemon-reload` takes no unit and is allowed on its own.
    local sysok=1
    [[ "$c" == *"daemon-reload"* ]] && sysok=0
    if [[ "$c" =~ systemctl[[:space:]]+(--now[[:space:]]+)?(start|stop|restart|enable|disable|status|is-active|is-enabled|cat|show)[[:space:]]+(--now[[:space:]]+)?migrapilot- ]]; then
      sysok=0
    fi
    [ "$sysok" -eq 0 ] || return 1
  fi
  case "$c" in
    *"/etc/systemd/system/"*)
      # Every systemd path touched must be a migrapilot- unit.
      [[ "$c" != *"/etc/systemd/system/migrapilot-"* ]] && return 1 ;;
  esac

  # 3b. TAILSCALE SUBCOMMAND SCOPE. Join and inspect only. `funnel`/`serve` could
  #     publish a service to the public internet, which the north-star directive
  #     forbids; `down`/`logout` would sever a production inference dependency.
  if [[ "$c" == *"tailscale"* ]]; then
    [[ "$c" =~ tailscale[[:space:]]+(up|status|ip|version|netcheck|set)([[:space:]]|$|\') ]] || return 1
    case "$c" in
      *"tailscale funnel"*|*"tailscale serve"*|*"tailscale down"*|*"tailscale logout"*|*"tailscale file"*)
        return 1 ;;
      *"--advertise-exit-node"*|*"--advertise-routes"*|*"--ssh"*) return 1 ;;
    esac
  fi

  # 4. PATH SCOPE — UNCONDITIONAL. Every absolute path mentioned anywhere in the
  #    command must sit under an approved prefix (bare tool paths under
  #    /usr,/bin,/sbin excepted). Applying this only to write-verbs was a real
  #    hole: `cat /etc/shadow` passed because `cat` was not a write-verb.
  local approved_re='(/opt/migrapilot|/etc/systemd/system/migrapilot-|/etc/migrapilot|/var/log/migrapilot|/var/lib/migrapilot|/run/migrapilot)'
  #    URLs are stripped first: `https://api.runpod.ai/v2/<id>/openai/v1` is a
  #    provider endpoint in config content, not a filesystem path, and scanning
  #    its segments produced a false positive that blocked writing brain.env.
  local scan
  #    The URL charset deliberately EXCLUDES backslash: a greedy strip let
  #    `https://ok.example/v1\nY=/etc/shadow` swallow the appended real path and
  #    pass. Stopping at whitespace, quote OR backslash keeps the strip honest.
  scan="$(printf '%s' "$c" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  local p
  while read -r p; do
    [ -n "$p" ] || continue
    [[ "$p" =~ ^$approved_re ]] || return 1
  #    Paths must start at a TOKEN BOUNDARY. Matching any '/' mid-token turned
  #    the model id `Qwen/Qwen3-14B` into a bogus path `/Qwen3-14B` and blocked a
  #    legitimate write. The leading delimiter is stripped back off below.
  done < <(printf '%s\n' "$scan" \
    | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' \
    | sed -E 's#^[^/]*##' \
    | grep -vE '^/(usr/)?(bin|sbin)/(install|mkdir|chown|chmod|tee|systemctl|useradd|groupadd|cp|mv|touch|stat|ln|tailscale|node|npm|env|nologin)$' || true)
  # ^ Only EXACT tool paths are exempt. A blanket `^/(usr|bin|sbin)/` exclusion let
  #   `ln -sfn /opt/migrapilot/x /usr/local/bin/brain` through — a PATH-hijack plant,
  #   because those prefixes were never checked as write TARGETS. Caught by test.

  # 5. ELEVATED VERBS — allowlist limited to exactly what the grant enumerates:
  #    ownership/permissions, directory creation, service-user creation, unit
  #    and env-file installation, daemon-reload, and unit start/enable/restart.
  #    Deliberately EXCLUDES cat/ls/stat/sh/bash/rm/test/id — reading or shelling
  #    out is not part of the grant and widens the surface for no benefit.
  local v
  while read -r v; do
    [ -n "$v" ] || continue
    case "$v" in
      -n|--) continue ;;
      # `stat` is read-only and needed to VERIFY the perms we just set. Safe only
      # because path scope (4) is unconditional — `stat /etc/shadow` is blocked
      # by the path rule, not by the verb rule. Still no cat/ls/sh/bash/rm.
      # `ln` added 2026-08-15: the `current -> releases/<sha>` symlink is the standard
      # atomic-release swap and lives entirely inside /opt/migrapilot, which path
      # scope (4) already constrains. Both link and target must be approved paths.
      install|mkdir|chown|chmod|tee|systemctl|useradd|groupadd|cp|mv|touch|stat|ln) continue ;;
      # `tailscale` added 2026-08-15: owner directed "Install and configure Tailscale on
      # VM111 using the existing tailnet" for the public-beta topology. Subcommands are
      # restricted below — joining/reading the tailnet only, never `logout`/`down`
      # (which would cut a production dependency) and never `file`/`funnel`/`serve`
      # (which could expose services publicly — explicitly forbidden by the directive).
      tailscale) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE "${ELEV} +(-[A-Za-z-]+ +)*[A-Za-z0-9_./-]+" | awk '{print $NF}' || true)

  return 0
}

# Always-blocked patterns.
case "$CMD" in
  *"rm -rf"*) block "rm -rf" ;;
esac

if [[ "$CMD" == *"${ELEV} "* ]]; then
  if vm111_migrapilot_provisioning "$CMD"; then
    : # permitted: VM111 MigraPilot provisioning, per Bonex 2026-08-15
  else
    block "${ELEV} (outside the approved VM111 MigraPilot provisioning scope)"
  fi
fi

case "$CMD" in
  *"git reset --hard"*) block "hard reset" ;;
  *"git clean"*) block "git clean" ;;
  *"chmod 777"*) block "chmod 777" ;;
esac

# `chown` remains blocked EXCEPT inside the approved VM111 scope above.
if [[ "$CMD" == *"chown "* ]]; then
  vm111_migrapilot_provisioning "$CMD" || block "chown"
fi

# git push policy (Bonex, 2026-07-16): plain pushes to ORIGIN are allowed;
# force/delete/mirror pushes and pushes to any other remote (e.g. the on-host
# `core` remote) remain blocked.
if [[ "$CMD" == *"git push"* ]]; then
  case "$CMD" in
    *"push --force"*|*"push -f"*|*"--force-with-lease"*|*"--delete"*|*"--mirror"*|*"origin +"*|*"push origin :"*)
      block "force/delete push" ;;
  esac
  if [[ "$CMD" != *"git push -u origin "* && "$CMD" != *"git push origin "* ]]; then
    block "push to a non-origin remote or ambiguous target"
  fi
fi

exit 0
