# Scoped exception — deploy the header/footer commit to VM 113 (web only)

Target SHA: `f87cf69b29478de789eb08076ad8e3a49e697aea`.

`git diff --name-only 2ab15f7..f87cf69` is four files, all under `apps/web/src`:
the header, footer, language switcher and the i18n dictionary. **No API source,
no Prisma schema, no migration, no package.json or lockfile change.**

So this grant needs neither a database nor the API: it fetches, detaches, builds
the web app, re-assembles the standalone tree and restarts `annoupale-web`
alone. `annoupale-api` keeps running untouched, which also means the API stays
available throughout.

Denied here that earlier grants allowed: **all database access** (no psql, no
prisma, no pg_dump), `npm ci`, `build:api`, and restarting the API.

```bash
vm113_annoupale_web_deploy() {
  local c="$1"

  # 1. HOST — VM 113 only.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in
    *"bonex@10.10.0.15"*|*"bonex@100.72.225.113"*) : ;;
    *) return 1 ;;
  esac
  case "$c" in
    *"root@"*|*"app-core"*|*"db-core"*|*"cloud-core"*|*"nginx-proxy-core"*|\
    *"migrapilot"*|*"pct exec"*|*"qm "*|*"@10.10.0.3"*|*"@10.10.0.6"*|\
    *"@138.201"*) return 1 ;;
  esac

  # 2. PALE — neutralise our own product name first.
  local _p="${c//annoupale/OURS}"
  case "$_p" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"pale-livekit"*|\
    *"internal.pale.app"*) return 1 ;;
  esac

  # 3. NO DATABASE, NO PRISMA, NO SECRETS. This change touches neither.
  case "$c" in
    *"psql"*|*"prisma"*|*"pg_dump"*|*"pg_restore"*|*"migration.sql"*|\
    *"DATABASE_URL="*|*"REDIS_URL="*|*"S3_"*"="*|*"JWT_SECRET="*|\
    *"REFRESH_TOKEN_SECRET="*|*"db.pw"*|*"_prisma_migrations"*) return 1 ;;
  esac

  # 4. GIT — exhaustive allowlist, canonical repo only.
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

  # 5. NPM — the web build only. No install, no API build.
  if [[ "$c" == *"npm "* || "$c" == *"npx "* ]]; then
    case "$c" in
      *"npm run build:web"*|*"npm run typecheck"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 6. HARD DENY.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                      return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)           return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"/etc/hosts"*)                   return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)    return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*)                         return 1 ;;
    *"docker"*|*"mc "*|*"tailscale up"*|*"livekit"*)                return 1 ;;
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"halt"*)                  return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                            return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 7. ELEVATION TARGET — the annoupale service account only.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 8. PM2 — the WEB process only. The API is not restarted by this deploy.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*) : ;;
      *"pm2 restart annoupale-web"*|*"pm2 start annoupale-web"*) : ;;
      *) return 1 ;;
    esac
    case "$c" in *"pm2 kill"*|*"pm2 delete"*|*"pm2 unstartup"*) return 1 ;; esac
  fi

  # 9. FILESYSTEM SCOPE — AnnouPale's own tree only.
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
  elif vm113_annoupale_web_deploy "$CMD"; then
    : # permitted: VM113 web-only deploy of f87cf69, per Bonex 2026-09-05.
      # TEMPORARY — remove once the deploy is verified.
```

## Plan

1. Fetch, detach to the full SHA, assert HEAD and a clean tree.
2. `npm run build:web` with `NEXT_PUBLIC_API_URL=http://10.10.0.15:3100/api`.
3. Re-assemble `static` and `public` into the standalone tree.
4. Restart `annoupale-web` only, with its own PORT/HOSTNAME/INTERNAL_API_URL.
5. Verify: pages 200, every header/footer link resolves, no dead store or social
   link rendered, desktop and 390px screenshots.
6. Remove this exception and prove it blocks again.

**The domain is not touched.** `annoupale.com` continues to serve VM 110.
