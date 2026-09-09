# Scoped exception — VM 113 PM2 persistence + full reboot test

Requested 2026-09-05, for the last infrastructure gate before VM 113 is "ready
for Bonex's user test".

**Verified problem this fixes:** `/etc/systemd/system/pm2-annoupale.service`
exists and is **enabled**, and its `ExecStart` is `pm2 resurrect` with
`PM2_HOME=/opt/annoupale/.pm2` — but **`/opt/annoupale/.pm2/dump.pm2` does not
exist**. `pm2 save` has never been run, so a reboot today would bring the VM back
with *nothing* running. The unit being "enabled" is not persistence.

Scope: save the PM2 process list, restart the VM once, verify the candidate comes
back by itself. Nothing else.

Narrower than every previous grant: **no git, no npm, no builds, no Docker, no
MinIO, no config or secret writes.** The only privileged verbs are `pm2 save` and
a single VM restart.

```bash
vm113_annoupale_reboot() {
  local c="$1"

  # 1. HOST — VM 113 only.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"bonex@10.10.0.15"* ]] || return 1
  case "$c" in
    *"root@10.10.0.15"*|*"app-core"*|*"db-core"*|*"cloud-core"*|\
    *"nginx-proxy-core"*|*"migrapilot"*|*"pct exec"*|*"qm "*|\
    *"@10.10.0.1"[0-4]*|*"@10.10.0.3"*|*"@10.10.0.6"*|*"@138.201"*) return 1 ;;
  esac

  # 2. PALE — neutralise our own product name first.
  local _p="${c//annoupale/OURS}"
  case "$_p" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"pale-livekit"*|\
    *"internal.pale.app"*) return 1 ;;
  esac

  # 3. NO CONFIG OR SECRET MUTATION. Reads stay available for verification.
  case "$c" in
    *"REDIS_URL="*|*"DATABASE_URL="*|*"S3_SECRET_ACCESS_KEY="*|*"S3_BUCKET="*|\
    *"S3_ACCESS_KEY_ID="*|*"S3_ENDPOINT="*|*"JWT_SECRET="*|\
    *"REFRESH_TOKEN_SECRET="*|*"OTP_VALIDATION_ALLOWLIST="*|\
    *"PRIVATE_VALIDATION_MODE="*|*"db.pw"*) return 1 ;;
  esac

  # 4. HARD DENY — absolutes and every capability outside this gate.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                       return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)            return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                 return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"/etc/hosts"*)                    return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)     return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*)                          return 1 ;;
    *"docker"*|*"mc "*|*"git "*|*"npm "*|*"npx "*|*"psql"*)          return 1 ;;
    *"postgresql.conf"*|*"pg_hba.conf"*|*"livekit"*)                 return 1 ;;
    *"tailscale up"*|*"tailscale logout"*|*"tailscale funnel"*)      return 1 ;;
    *"shutdown"*|*"init 0"*|*"poweroff"*|*"halt"*)                   return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                             return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 5. THE RESTART — exactly one form, and only a restart (never a power-off).
  #    `systemctl reboot` restarts; the poweroff/halt/shutdown verbs are denied
  #    above, so this VM can never be left switched off by this grant.
  if [[ "$c" == *"reboot"* ]]; then
    case "$c" in
      *"${ELEV} systemctl reboot"*|*"${ELEV} -n systemctl reboot"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 6. ELEVATION TARGET — the annoupale service account, plus the single
  #    systemctl restart admitted by rule 5.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *"${ELEV} systemctl reboot"*|*"${ELEV} -n systemctl reboot"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 7. PM2 — save/inspect, and start/restart of AnnouPale processes only.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 save"*|*"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*|\
      *"pm2 resurrect"*) : ;;
      *"pm2 restart"*|*"pm2 start"*|*"pm2 stop"*)
        [[ "$c" == *"annoupale-"* ]] || return 1 ;;
      *) return 1 ;;
    esac
    case "$c" in *"pm2 kill"*|*"pm2 delete"*|*"pm2 unstartup"*) return 1 ;; esac
  fi

  # 8. FILESYSTEM SCOPE — every write path must be AnnouPale's own.
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
  elif vm113_annoupale_reboot "$CMD"; then
    : # permitted: VM113 PM2 persistence + reboot test, per Bonex 2026-09-05.
      # TEMPORARY — remove with the function once the reboot test passes.
```

**Removed immediately after the reboot test is verified.**

## Planned sequence

1. `pm2 save` as `annoupale`; confirm `/opt/annoupale/.pm2/dump.pm2` now exists.
2. `systemctl reboot`.
3. Wait for SSH to answer again.
4. Verify **without touching anything**: both PM2 processes online, correct ports,
   `NODE_ENV=production`, API health db+redis green, web 200, OTP allowlist 403,
   storage read through the `annoupale` bucket, zero Pale routes.

## Tailscale — Bonex's step, not the agent's

Interactive browser login is required, so this rule **denies** `tailscale up`
outright. VM 113 currently reports `Logged out`; `tailscaled` 1.102.3 is active
and enabled, and its only outbound peer is the Tailscale control-plane LB.

1. In the Tailscale admin ACL, add `tag:annoupale-core` (and `tag:pale-core`) to
   `tagOwners`.
2. On VM 113, as root, run tailscale's `up` subcommand with
   `--advertise-tags=tag:annoupale-core`.
3. Complete the browser login. **Do not paste the auth URL into this chat** — it
   is temporary authentication material.
4. `tailscale status` should then show the node. Tagged nodes have no key expiry.
