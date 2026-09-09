# Scoped exception — publish the current branch to VM 113

Bonex, 2026-09-05: *"the platform not open to the public yet we can make any
changes we want"* and *"once you meet all that publish live"*.

Target SHA: `2ab15f7` (branch `chore/vm113-isolation-candidate`), which is
`b5219ad` (the privately validated candidate) plus the landing rebuild, the
Sept 5 banner, the sign-up rebuild, the sideways-scroll / focus-trap / signin
fixes, and the signup account-enumeration fix.

Two things this grant must allow that earlier ones deliberately did not:

1. **Applying one Prisma migration to the candidate database.**
   `20260905170000_signup_profile_intent` adds `full_name`, `account_type` and
   `interests` to `users`. Without it every signup 500s, so the code cannot ship
   without it. It is additive and backwards compatible — all three are nullable
   or defaulted, so the currently-running build keeps working against a migrated
   database, which is what makes rollback safe.
   It is applied by piping THAT ONE FILE through psql. `prisma migrate deploy` is
   still denied outright, per Bonex's standing instruction.

2. **Rebuilding and restarting on VM 113.**

Still denied: VM 110, the old `pale` bucket, nginx/DNS/firewall, any other
database or migration, secret rewrites, and Docker.

```bash
vm113_annoupale_publish() {
  local c="$1"

  # 1. HOSTS — VM 113 (either address), plus db-core ONLY for the one migration.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in
    *"bonex@10.10.0.15"*|*"bonex@100.72.225.113"*) : ;;
    *) return 1 ;;
  esac
  case "$c" in
    *"root@"*|*"app-core"*|*"cloud-core"*|*"nginx-proxy-core"*|*"migrapilot"*|\
    *"pct exec"*|*"qm "*|*"@138.201"*) return 1 ;;
  esac

  # 2. PALE — neutralise our own product name, then any Pale form is Pale.
  local _p="${c//annoupale/OURS}"
  case "$_p" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"pale-livekit"*|\
    *"internal.pale.app"*|*"local/pale"*|*"S3_BUCKET=pale"*) return 1 ;;
  esac

  # 3. THE ONE MIGRATION — by exact filename, and never via prisma.
  if [[ "$c" == *"psql"* || "$c" == *"migration.sql"* ]]; then
    [[ "$c" == *"20260905170000_signup_profile_intent"* ]] || return 1
    [[ "$c" == *"annoupale"* ]] || return 1
    case "$c" in
      *"DROP "*|*"TRUNCATE"*|*"DELETE FROM"*|*"ALTER ROLE"*|*"CREATE ROLE"*|\
      *"pg_dump"*|*"pg_restore"*|*"GRANT "*|*"REVOKE "*) return 1 ;;
    esac
  fi
  case "$c" in *"prisma migrate"*|*"prisma db push"*) return 1 ;; esac

  # 4. NO SECRET OR STORAGE REWRITES. Reads stay available.
  case "$c" in
    *"REDIS_URL="*|*"DATABASE_URL="*|*"S3_SECRET_ACCESS_KEY="*|*"S3_BUCKET="*|\
    *"S3_ACCESS_KEY_ID="*|*"S3_ENDPOINT="*|*"JWT_SECRET="*|\
    *"REFRESH_TOKEN_SECRET="*|*"OTP_VALIDATION_ALLOWLIST="*|\
    *"PRIVATE_VALIDATION_MODE="*|*"db.pw"*) return 1 ;;
  esac

  # 5. GIT — exhaustive allowlist, canonical repo only.
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

  # 6. NPM — exhaustive allowlist of this repo's own scripts.
  if [[ "$c" == *"npm "* || "$c" == *"npx "* ]]; then
    case "$c" in
      *"npm ci"*|*"npm run build:api"*|*"npm run build:web"*|\
      *"npm run clean:api"*|*"npm run typecheck"*|\
      *"npm run prisma:generate"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 7. HARD DENY.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                      return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)           return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"/etc/hosts"*)                   return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)    return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*)                         return 1 ;;
    *"docker"*|*"mc "*|*"tailscale up"*|*"livekit"*)                return 1 ;;
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"halt"*)                  return 1 ;;
    *"postgresql.conf"*|*"pg_hba.conf"*)                            return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                            return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 8. ELEVATION TARGET — the annoupale service account only.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 9. PM2 — AnnouPale processes only.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*|*"pm2 save"*) : ;;
      *"pm2 restart"*|*"pm2 start"*|*"pm2 stop"*)
        [[ "$c" == *"annoupale-"* ]] || return 1 ;;
      *) return 1 ;;
    esac
    case "$c" in *"pm2 kill"*|*"pm2 delete"*|*"pm2 unstartup"*) return 1 ;; esac
  fi

  # 10. FILESYSTEM SCOPE — AnnouPale's own tree only.
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
  elif vm113_annoupale_publish "$CMD"; then
    : # permitted: publish 2ab15f7 to VM113, per Bonex 2026-09-05.
      # TEMPORARY — remove once the deploy is verified.
```

## Plan

1. Back up the `users` table on the candidate database first, so the schema
   change is reversible.
2. Apply `20260905170000_signup_profile_intent` by piping that one file to psql.
3. Fetch, detach to `2ab15f7`, `npm ci`, clean-rebuild API and web with
   `NEXT_PUBLIC_API_URL=http://10.10.0.15:3100/api`.
4. Restart `annoupale-api` and `annoupale-web` with their SEPARATE environments.
5. Re-run the smoke battery, then sign up through the real browser form against
   VM 113 and confirm the row carries full_name / account_type / interests.
6. Remove this exception and prove it blocks again.

**Not in this grant:** pointing `annoupale.com` at VM 113. That is an nginx/DNS
change on shared infrastructure and stays a separate, explicit decision.
