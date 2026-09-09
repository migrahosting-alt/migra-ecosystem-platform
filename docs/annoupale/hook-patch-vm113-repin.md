# Scoped exception — VM 113 re-pin and clean rebuild at `b5219ad`

Requested 2026-09-05. Bonex: *"VM 113 should now move to `b5219ad` before the
next full validation pass… Do not just keep running the old build indefinitely
and treat the repository state as equivalent."*

Scope: fetch the candidate branch, detach to the exact SHA, clean-rebuild API and
web, restart the two AnnouPale PM2 processes, re-run the private smoke battery.

Narrower than the original deployment grant: **no Docker, no MinIO, no env-secret
writes.** The storage and OTP configuration is already correct and must not be
re-touched, so any command naming a secret or storage assignment is denied.

Rule 4 uses an **exhaustive allowlist** of git verbs rather than a deny-list, so
every mutating verb — push, remote, config, reset, clean, rebase — falls through
to `return 1` without needing to be named.

```bash
vm113_annoupale_repin() {
  local c="$1"

  # 1. HOST — VM 113 only.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"bonex@10.10.0.15"* ]] || return 1
  case "$c" in
    *"root@10.10.0.15"*|*"app-core"*|*"db-core"*|*"cloud-core"*|\
    *"nginx-proxy-core"*|*"migrapilot"*|*"pct exec"*|*"@10.10.0.1"[0-4]*|\
    *"@10.10.0.3"*|*"@10.10.0.6"*|*"@138.201"*) return 1 ;;
  esac

  # 2. PALE — neutralise our own product name first.
  local _p="${c//annoupale/OURS}"
  case "$_p" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"pale-livekit"*|\
    *"internal.pale.app"*) return 1 ;;
  esac

  # 3. NO SECRET OR STORAGE RECONFIGURATION.
  #    api.env is already correct; this grant is for code, not configuration.
  case "$c" in
    *"S3_SECRET_ACCESS_KEY"*|*"S3_BUCKET"*|*"S3_ACCESS_KEY"*|*"S3_ENDPOINT"*|\
    *"JWT_SECRET"*|*"REFRESH_TOKEN_SECRET"*|*"PALE_INTERNAL_API_SECRET"*|\
    *"OTP_VALIDATION_ALLOWLIST"*|*"PRIVATE_VALIDATION_MODE"*|\
    *"REDIS_URL="*|*"DATABASE_URL="*|*"db.pw"*) return 1 ;;
  esac

  # 4. GIT — exhaustive allowlist of read-only/checkout verbs, canonical repo only.
  if [[ "$c" == *"git "* ]]; then
    case "$c" in
      *"git fetch"*|*"git checkout --detach"*|*"git rev-parse"*|\
      *"git status"*|*"git log"*|*"git show"*) : ;;
      *) return 1 ;;
    esac
    if [[ "$c" == *"git fetch"* ]]; then
      case "$c" in
        *"github.com/migrahosting-alt/annoupale"*|\
        *"github.com:migrahosting-alt/annoupale"*|*"origin"*) : ;;
        *) return 1 ;;
      esac
    fi
  fi

  # 5. HARD DENY — absolutes and everything outside this scope.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                       return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)            return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                 return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"/etc/hosts"*)                    return 1 ;;
    *"reboot"*|*"shutdown"*|*"init 0"*|*"init 6"*)                   return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)     return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*)                          return 1 ;;
    *"docker"*|*"mc "*|*"tailscale up"*)                             return 1 ;;
    *"postgresql.conf"*|*"pg_hba.conf"*|*"psql"*)                    return 1 ;;
    *"livekit"*|*"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                 return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 6. NPM — exhaustive allowlist of this repo's own scripts.
  if [[ "$c" == *"npm "* || "$c" == *"npx "* ]]; then
    case "$c" in
      *"npm ci"*|*"npm run build:api"*|*"npm run build:web"*|\
      *"npm run clean:api"*|*"npm run typecheck"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 7. ELEVATION TARGET — the annoupale service account only.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 8. PM2 — only AnnouPale-named processes.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*|*"pm2 save"*) : ;;
      *"pm2 restart"*|*"pm2 stop"*|*"pm2 start"*|*"pm2 delete"*)
        [[ "$c" == *"annoupale-"* ]] || return 1 ;;
      *) return 1 ;;
    esac
    case "$c" in *"pm2 kill"*|*"pm2 unstartup"*) return 1 ;; esac
  fi

  # 9. FILESYSTEM SCOPE — every write path must be AnnouPale's own.
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
  elif vm113_annoupale_repin "$CMD"; then
    : # permitted: VM113 re-pin + clean rebuild at b5219ad, per Bonex 2026-09-05.
      # TEMPORARY — remove with the function once the smoke battery is re-run.
```

**Removed immediately after the private smoke battery is re-run at `b5219ad`.**
