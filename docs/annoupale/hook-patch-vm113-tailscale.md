# Scoped exception — VM 113 Tailscale enrolment (only if Bonex wants the agent to run it)

State verified 2026-09-05: `tagOwners` already contains `tag:annoupale-core` and
`tag:pale-core`; no `annoupale-core` node exists in the tailnet; VM 113 reports
`Logged out` with `tailscaled` 1.102.3 active and enabled.

The only remaining command is the enrolment itself. It is interactive: it prints
a single-use authentication URL that must be approved in a browser.

```bash
vm113_annoupale_tailscale() {
  local c="$1"

  # 1. HOST — VM 113 only.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"bonex@10.10.0.15"* ]] || return 1
  case "$c" in
    *"root@10.10.0.15"*|*"app-core"*|*"db-core"*|*"cloud-core"*|\
    *"nginx-proxy-core"*|*"migrapilot"*|*"pct exec"*|*"qm "*|\
    *"@10.10.0.1"[0-4]*|*"@10.10.0.3"*|*"@10.10.0.6"*|*"@138.201"*) return 1 ;;
  esac

  # 2. TAILSCALE — exactly one enrolment form, plus read-only status.
  #    The hostname and tag are pinned, so the node cannot be enrolled
  #    untagged, under another identity, or as an exit node / subnet router.
  if [[ "$c" == *"tailscale"* ]]; then
    case "$c" in
      *"tailscale status"*|*"tailscale ip"*|*"tailscale version"*|\
      *"tailscale netcheck"*|*"tailscale whois"*) : ;;
      *"tailscale up"*)
        [[ "$c" == *"--hostname=annoupale-core"* ]] || return 1
        [[ "$c" == *"--advertise-tags=tag:annoupale-core"* ]] || return 1
        case "$c" in
          *"--advertise-exit-node"*|*"--advertise-routes"*|*"--ssh"*|\
          *"--accept-routes"*|*"--exit-node"*|*"--authkey"*|*"--auth-key"*|\
          *"--login-server"*|*"--force-reauth"*) return 1 ;;
        esac ;;
      *) return 1 ;;
    esac
  fi

  # 3. HARD DENY — everything outside this single gate.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                       return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)            return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                 return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"/etc/hosts"*)                    return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)     return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*)                          return 1 ;;
    *"docker"*|*"mc "*|*"git "*|*"npm "*|*"npx "*|*"psql"*|*"pm2"*)  return 1 ;;
    *"postgresql.conf"*|*"pg_hba.conf"*|*"livekit"*)                 return 1 ;;
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"halt"*|*"init 0"*)        return 1 ;;
    *"tailscale logout"*|*"tailscale funnel"*|*"tailscale serve"*|\
    *"tailscale down"*|*"tailscale set"*|*"tailscale login"*)        return 1 ;;
    *"REDIS_URL="*|*"DATABASE_URL="*|*"S3_"*"="*|*"JWT_SECRET="*|\
    *"REFRESH_TOKEN_SECRET="*|*"db.pw"*)                             return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                             return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 4. ELEVATION TARGET — root only for the tailscale binary itself.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} tailscale "*|*"${ELEV} -n tailscale "*) : ;;
      *) return 1 ;;
    esac
  fi

  # 5. FILESYSTEM SCOPE — no writes outside AnnouPale's own tree.
  case "$c" in
    *"tee "*|*"chmod"*|*"chown"*|*"install "*|*" > "*|*" >> "*|*"cp "*|\
    *"mv "*|*"sed -i"*|*"mkdir"*|*"shred"*|*"truncate"*|*"rm "*)
      case "$c" in
        *"/opt/annoupale"*) : ;;
        *) return 1 ;;
      esac ;;
  esac

  return 0
}
```

Dispatch line:

```bash
  elif vm113_annoupale_tailscale "$CMD"; then
    : # permitted: VM113 Tailscale enrolment, per Bonex 2026-09-05.
      # TEMPORARY — remove with the function once the node is up and reachable.
```

## The authentication-URL problem

Bonex's standing instruction is: *"Do not paste that authentication URL here.
Treat it as temporary authentication material."*

`tailscale up` prints that URL to stdout, so running it under this grant would
put single-use auth material into the transcript. That is why **the recommended
path is that Bonex runs the enrolment himself** — it is one command plus a
browser click, and it keeps the URL out of the conversation entirely.

If Bonex would rather the agent run it, he should say so explicitly, accepting
that the single-use URL will appear in command output.
