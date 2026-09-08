# Scoped hook grant — `migra-search-core` (PREPARED, NOT APPLIED)

**Status: awaiting Bonex.** This document contains the exact rule; it has not
been added to `.claude/hooks/block-dangerous.sh`. Every other scoped exception
in that file records that the agent applied a rule *prepared in a document at
explicit instruction* and did not author or broaden the authorization. This
follows that pattern, and the agent has not edited the hook.

## Why this exists

Migra Search needs a retrieval backend. Bonex directed (2026-09-08) that it run
on its **own host**, not VM111 — search is a shared platform service, and
coupling Brain/Consumer resource pressure, upgrades and provider failures to it
is the wrong failure domain.

The VM111 grant cannot be reused or widened: it is bounded to MigraPilot's own
units and hard-denies `apt`, `pip`, `docker` and any systemd unit not named
`migrapilot-*`. Widening it would put container authority on the host running
production Brain and Consumer, which is precisely the coupling this deployment
exists to avoid.

## Prerequisite the agent cannot satisfy

`migra-search-core` **does not exist**. It has no DNS record and no SSH alias.
Creating the VM is Proxmox work and is not covered by any grant. That step is
Bonex's, and this rule is useless until the host exists and is reachable over
the tailnet.

## Scope, as Bonex defined it

Authorized:

- create/manage the `migra-search-core` host
- install and use Docker **on that host only**
- manage only `migra-search-*` containers/services
- write only under the dedicated search service paths
- manage only the dedicated systemd wrapper/unit, if one is used

Refused, explicitly:

- broad `apt` / `pip` / `docker` / systemd authority outside that host and scope
- any authority over Brain or Consumer units
- killing arbitrary processes
- global Docker cleanup or prune
- firewall changes beyond the explicit search-service exposure required
- production cutover — that needs a separate deploy authorization

## The rule

Add the function below, and add its dispatch line to the elevation block
alongside the existing exceptions.

```bash
# ─────────────────────────────────────────────────────────────────────────────
# SCOPED EXCEPTION — migra-search-core (Migra Search retrieval backend)
#
# Authorized by Bonex, 2026-09-08, in writing, bounded to:
#   "create/manage the migra-search-core VM or target host; install/use Docker
#    on that host only; manage only migra-search-* containers/services; write
#    only under the dedicated search service paths; manage only the dedicated
#    systemd wrapper/unit if one is used. No broad apt, pip, docker or systemd
#    authority outside that host/scope. No permission to touch Brain/Consumer
#    units, kill arbitrary processes, run global Docker cleanup/prune, or make
#    firewall changes beyond the explicit search-service exposure required. No
#    production cutover without a separate deploy authorization."
#
# NARROWER THAN VM111 ON PURPOSE: one host, one service family, no reach into
# anything MigraPilot runs. The whole point of a separate host is that this
# grant cannot touch production Brain or Consumer, so it is written so that it
# structurally cannot.
# ─────────────────────────────────────────────────────────────────────────────
searchcore_provisioning() {
  local c="$1"

  # 1. HOST — the search host alias, and no other host anywhere in the command.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"migra-search-core"* ]] || return 1
  case "$c" in
    *"migrapilot-app-core"*|*"db-core"*|*"nginx-proxy-core"*|*"root@"*|\
    *" pve "*|*"-J pve"*|*"pct exec"*|*"qm "*|*"@10.10.0."*|*"@100."*)
      return 1 ;;
  esac

  # 2. HARD DENY — never permitted under this exception, even on this host.
  case "$c" in
    *"rm -rf"*|*"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)          return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)               return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)          return 1 ;;
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"halt"*)                 return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*)                           return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                           return 1 ;;
    # Global container cleanup would reach containers this grant does not own.
    *"docker system prune"*|*"docker volume prune"*|*"docker image prune"*|\
    *"docker container prune"*|*"docker network prune"*|*"prune -a"*)
      return 1 ;;
    # Process authority is not part of this grant.
    *"pkill"*|*"killall"*|*" kill "*)                              return 1 ;;
  esac

  # 3. MIGRAPILOT IS OUT OF REACH — the reason this host exists.
  case "$c" in
    *"migrapilot"*|*"/opt/migrapilot"*)                            return 1 ;;
  esac

  # 4. DOCKER SCOPE — only migra-search-* containers/services, and never a
  #    command that acts on ALL containers.
  if [[ "$c" == *"docker"* ]]; then
    case "$c" in
      *"docker compose"*|*"docker-compose"*) : ;;
      *"docker ps"*|*"docker logs"*|*"docker inspect"*|*"docker version"*|*"docker info"*) : ;;
      *"docker pull"*|*"docker images"*) : ;;
      *"docker start migra-search-"*|*"docker stop migra-search-"*|\
      *"docker restart migra-search-"*|*"docker rm migra-search-"*) : ;;
      *) return 1 ;;
    esac
    # A compose file outside the service path would reach other stacks.
    case "$c" in
      *"-f "*)
        [[ "$c" == *"-f /opt/migra-search/"* ]] || return 1 ;;
    esac
    case "$c" in
      *" -a"*|*"--all"*|*"docker rm -f "*) return 1 ;;
    esac
  fi

  # 5. PACKAGE INSTALLS — only what a container host needs, on this host.
  if [[ "$c" == *"apt "* || "$c" == *"apt-get"* ]]; then
    case "$c" in
      *"apt-get update"*|*"apt update"*) : ;;
      *"install docker.io"*|*"install docker-compose-plugin"*|\
      *"install ca-certificates"*|*"install curl"*) : ;;
      *) return 1 ;;
    esac
    case "$c" in *"remove"*|*"purge"*|*"dist-upgrade"*|*"full-upgrade"*) return 1 ;; esac
  fi
  case "$c" in *"pip install"*|*"npm i -g"*|*"npm install -g"*|*"snap install"*) return 1 ;; esac

  # 6. SYSTEMD SCOPE — only a migra-search-* unit, and only these verbs.
  if [[ "$c" == *"systemctl"* ]]; then
    local sysok=1
    [[ "$c" == *"daemon-reload"* ]] && sysok=0
    if [[ "$c" =~ systemctl[[:space:]]+(--now[[:space:]]+)?(start|stop|restart|enable|disable|status|is-active|is-enabled|cat|show)[[:space:]]+(--now[[:space:]]+)?migra-search- ]]; then
      sysok=0
    fi
    [ "$sysok" -eq 0 ] || return 1
  fi
  case "$c" in
    *"/etc/systemd/system/"*)
      [[ "$c" != *"/etc/systemd/system/migra-search-"* ]] && return 1 ;;
  esac

  # 7. PATH SCOPE — UNCONDITIONAL, same shape as the VM111 rule. Every absolute
  #    path must sit under an approved prefix; bare tool paths are exempted by
  #    exact match only.
  local approved_re='(/opt/migra-search|/etc/systemd/system/migra-search-|/etc/migra-search|/var/log/migra-search|/var/lib/migra-search)'
  local scan
  scan="$(printf '%s' "$c" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  local p
  while read -r p; do
    [ -n "$p" ] || continue
    [[ "$p" =~ ^$approved_re ]] || return 1
  done < <(printf '%s\n' "$scan" \
    | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' \
    | sed -E 's#^[^/]*##' \
    | grep -vE '^/(usr/)?(bin|sbin)/(install|mkdir|chown|chmod|tee|systemctl|cp|mv|touch|stat|ln|docker|env|curl)$' || true)

  # 8. ELEVATED VERBS — allowlist, same reasoning as VM111: no cat/ls/sh/bash/rm.
  local v
  while read -r v; do
    [ -n "$v" ] || continue
    case "$v" in
      -n|--) continue ;;
      install|mkdir|chown|chmod|tee|systemctl|cp|mv|touch|stat|ln|docker|apt|apt-get) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE "${ELEV} +(-[A-Za-z-]+ +)*[A-Za-z0-9_./-]+" | awk '{print $NF}' || true)

  return 0
}
```

Dispatch line, added to the elevation block:

```bash
  elif searchcore_provisioning "$CMD"; then
    : # permitted: migra-search-core provisioning, per Bonex 2026-09-08
```

## Note on what this grant still cannot do

`rm -rf` remains blocked unconditionally by the always-blocked pattern at the
top of the hook, as it is for every other scope. Container teardown therefore
uses `docker rm migra-search-*`, not filesystem deletion. That is a deliberate
consequence, not an oversight.

## Removal

Remove this block and its dispatch line once the search backend is deployed and
verified, as every other temporary grant in that file records having done.
