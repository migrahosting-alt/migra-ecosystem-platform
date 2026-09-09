# Scoped exception — deploy the same-origin realtime fix to VM 113 (web only)

Target SHA: `5c90a1d5bf286826e3f76160d5b581458d765bcd`.

`git diff --name-only f87cf69..5c90a1d` is exactly two files, both under
`apps/web/src/lib/realtime`: the `useRealtimeSocket` hook and its new unit test.
**No API source, no Prisma schema, no migration, no package.json or lockfile
change.**

So this grant needs neither a database nor the API. It fetches, detaches, builds
the web app, re-assembles the standalone tree and restarts `annoupale-web`
alone. `annoupale-api` keeps running untouched — which is also a gate Bonex
asked to be verified, so nothing here may restart it.

Identical in scope to `hook-patch-vm113-web-deploy.md`, which Bonex approved for
`f87cf69`, with **one deliberate difference**: the build must run with
`NEXT_PUBLIC_API_URL` **unset**. Setting it is the bug being fixed — the last
deploy baked `http://10.10.0.15:3100/api` into three browser chunks.

Denied here, as in that grant: **all database access** (no psql, no prisma, no
pg_dump), `npm ci`, `build:api`, and restarting the API.

```bash
vm113_annoupale_realtime_deploy() {
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
    *"@10.10.0.10"*|*"@138.201"*) return 1 ;;
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
      *"git status"*|*"git log"*|*"git show"*|*"git diff"*) : ;;
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
      *"npm run build:web"*|*"npm run typecheck"*|*"npm run -s typecheck"*) : ;;
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

  # 8. PM2 — the WEB process only. The API must NOT be restarted; Bonex
  #    listed "API process not restarted" as an explicit acceptance gate.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*) : ;;
      *"pm2 restart annoupale-web"*|*"pm2 start annoupale-web"*) : ;;
      *) return 1 ;;
    esac
    case "$c" in
      *"pm2 kill"*|*"pm2 delete"*|*"pm2 unstartup"*|\
      *"annoupale-api"*|*"pm2 restart all"*|*"pm2 reload"*) return 1 ;;
    esac
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
  elif vm113_annoupale_realtime_deploy "$CMD"; then
    : # permitted: VM113 web-only deploy of 5c90a1d, per Bonex 2026-09-05.
      # TEMPORARY — remove once the deploy is verified.
```

## Plan

1. Fetch, detach to the full SHA, assert HEAD and a clean tree.
2. Assert no `.env*` in the build tree could inject `NEXT_PUBLIC_API_URL`.
3. `npm run build:web` with `NEXT_PUBLIC_API_URL` **unset**.
4. Assert 0 browser chunks contain a private address, before restarting anything.
5. Re-assemble `static` and `public` into the standalone tree.
6. Restart `annoupale-web` only, with its own PORT/HOSTNAME/INTERNAL_API_URL.
   Record `annoupale-api` pid + restart count before and after — they must not
   change.
7. Verify: web/signin/signup 200, `/socket.io/` handshake 200, BUILD_ID matches,
   and a real browser proving the socket dials the page origin.
8. Remove this exception and prove it blocks again.

**The domain is not touched.** `annoupale.com` continues to serve VM 110, which
remains rollback authority. This grant contains no nginx, DNS or TLS capability
of any kind — `*"nginx"*` is a hard deny in rule 6.
