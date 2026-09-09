# Prepared hook rule — VM 113 `annoupale-core` first-build provisioning

**Status: PREPARED, NOT APPLIED.** Written by the agent for Bonex to review.
The agent has not modified `.claude/hooks/block-dangerous.sh`.

## Why a new exception is needed

Both existing exceptions deliberately **hard-deny** exactly what a first OS
build requires:

```
*"apt "*|*"apt-get"*|…|*"npm install -g"*)   return 1
*"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)          return 1
*"ufw "*|*"iptables"*|*"nft "*)               return 1
```

So this grant is **broader than either precedent**, and that is the thing to
weigh before applying it. It is scoped to one brand-new host with no data and
no production traffic, and it is meant to be **removed once VM 113 is
provisioned**.

## Bounds

| | |
|---|---|
| Host | `bonex@10.10.0.15` only, reached via `-J root@138.201.255.55` |
| Any other host named in the command | blocked |
| Root SSH | stays disabled; this permits `sudo` as `bonex` only |
| Firewall commands | still blocked — nftables policy is a later, separate step |
| SSH config / sudoers / authorized_keys | still blocked |
| `tailscale up` | permitted; `funnel` / `serve` still blocked |
| Anything naming `/opt/pale` or `PALE_` | blocked, so this cannot touch Pale |
| Lifetime | build phase only — delete after provisioning |

## The rule

Insert alongside the other exception functions, and add a
`vm113_annoupale_provisioning "$CMD" && exit 0` line at the same dispatch point
the others use.

```bash
# ---------------------------------------------------------------------------
# SCOPED EXCEPTION - VM113 annoupale-core first-build provisioning
#
# Authorized by Bonex, 2026-09-05, bounded to: "base OS packages, Tailscale,
# Docker, Node 20, PM2, the annoupale service account and its directory
# layout, and 2 GB of swap, on VM 113 only. Not for firewall policy, SSH
# hardening, other hosts, or application/credential work."
#
# BROADER than the VM111 and db-core exceptions because a first OS build needs
# apt, an installer script, and a global npm package. Delete once VM 113 is
# provisioned.
# ---------------------------------------------------------------------------
vm113_annoupale_provisioning() {
  local c="$1"

  # 1. HOST - must target VM 113, and no other host may appear.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"bonex@10.10.0.15"* ]] || return 1
  case "$c" in
    *"root@10.10.0.15"*|*"app-core"*|*"db-core"*|*"cloud-core"*|\
    *"nginx-proxy-core"*|*"migrapilot"*|*"pct exec"*|*"@10.10.0.1"[0-4]*)
      return 1 ;;
  esac

  # 2. HARD DENY - absolutes, even on a throwaway build host.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                        return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                  return 1 ;;
    *"reboot"*|*"shutdown"*|*"init 0"*|*"init 6"*)                    return 1 ;;
    *"passwd "*|*"gpasswd"*)                                           return 1 ;;
    *"tailscale funnel"*|*"tailscale serve"*)                         return 1 ;;
    *"/opt/pale"*|*"PALE_"*)                                           return 1 ;;
  esac
  # recursive-force delete, matched without writing the bare token here
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 3. INSTALLER SCRIPTS - only these two publishers may be piped to a shell.
  if [[ "$c" == *"curl"*"|"*"sh"* || "$c" == *"wget"*"|"*"sh"* ]]; then
    case "$c" in
      *"https://tailscale.com/install.sh"*) : ;;
      *"https://get.docker.com"*)           : ;;
      *) return 1 ;;
    esac
  fi

  # 4. GLOBAL NPM - pm2 only.
  if [[ "$c" == *"npm install -g"* || "$c" == *"npm i -g"* ]]; then
    [[ "$c" == *"pm2"* ]] || return 1
  fi

  # 5. SYSTEMD - enable/start only these units.
  if [[ "$c" == *"systemctl"* ]]; then
    local sysok=1
    [[ "$c" == *"daemon-reload"* ]] && sysok=0
    if [[ "$c" =~ systemctl[[:space:]]+(--now[[:space:]]+)?(start|enable|status|is-active|is-enabled)[[:space:]]+(--now[[:space:]]+)?(qemu-guest-agent|chrony|tailscaled|docker) ]]; then
      sysok=0
    fi
    [ "$sysok" -eq 0 ] || return 1
  fi

  # 6. FILESYSTEM WRITES - confined to AnnouPale's own tree and the swapfile.
  case "$c" in
    *"chown"*|*"chmod"*|*"mkdir"*|*"tee "*)
      case "$c" in
        *"/opt/annoupale"*|*"/var/log/annoupale"*|*"/swapfile"*) : ;;
        *) return 1 ;;
      esac ;;
  esac

  return 0
}
```

## To apply

Review the above, then either apply it yourself or tell the agent to apply
**this exact text**. After VM 113 is provisioned, delete the function and its
dispatch line.

## Note on one limitation

The rule matches on the command string. The build commands are piped to
`ssh … 'bash -s'`, so the *body* of the script is not in the matched string —
only the ssh invocation is. That means the host bound (rule 1) is the load
bearing control here, and the deny lists are defence in depth rather than a
complete sandbox. If you want the body inspected too, the build has to be run
as individual `ssh … 'command'` invocations rather than a piped script; say so
and the agent will run it that way instead.
