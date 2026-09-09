# Scoped exception — deploy the auth redesign to VM 113 (web only)

Target SHA: `05fd499e0834812ab65a376575deb93f4ed17e65`.

`git diff --name-only 5c90a1d..05fd499` is four files, all under `apps/web/src`:
the auth shell, the `(auth)` layout, and the sign-in and sign-up pages. **No API
source, no Prisma schema, no migration, no package.json or lockfile change.**

Same shape as `hook-patch-vm113-realtime-deploy.md`, which you approved for
`5c90a1d`, with one narrowing and one widening, both deliberate.

## 🚨 What is different this time: the site is PUBLIC

When the realtime fix shipped, `annoupale.com` still pointed at VM 110 and this
was a candidate. It is now the live site. Two consequences the procedure has to
respect:

1. **Static assets are copied additively, never with `--delete`.** A browser
   mid-session holds HTML referencing the old chunk hashes; removing them would
   404 those users. `cp -a` adds the new chunks and leaves the old ones in place.
2. **Restarting the web process is a real, if brief, public interruption**
   (a few seconds). There is no zero-downtime path with a single web process,
   and adding one is not in scope for a four-file visual change.

**Rollback** is `git checkout --detach 5c90a1d`, rebuild, re-assemble, restart —
roughly two to three minutes. The API is never touched, so a failed web deploy
cannot take data or auth down with it.

## Narrowed vs the realtime grant

That grant denied any command containing `annoupale-api`, which also blocked
*reading* the API's logs — over-broad, and it bit during that deploy. Here the
API may be **read** (`pm2 logs`, `pm2 describe`) but never restarted, stopped,
deleted or reloaded. The acceptance gate "API untouched" is asserted by pid and
restart count, not by refusing to look at it.

```bash
vm113_annoupale_auth_deploy() {
  local c="$1"

  # 1. HOST — VM 113 only.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in
    *"bonex@10.10.0.15"*|*"bonex@100.72.225.113"*) : ;;
    *) return 1 ;;
  esac
  # Neutralise the one permitted host, then refuse any other core box.
  local _h="${c//bonex@10.10.0.15/VM113}"
  case "$_h" in
    *"root@"*|*"-core"*|*"@10.10.0.10"*|*"@10.10.0.3"*|*"@10.10.0.6"*|\
    *"pct exec"*|*"qm "*|*"migrapilot"*) return 1 ;;   # incl. nginx-proxy-core
  esac

  # 2. PALE — neutralise our own product name first.
  local _p="${c//annoupale/OURS}"
  case "$_p" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"pale-livekit"*|\
    *"internal.pale.app"*) return 1 ;;
  esac

  # 3. NO DATABASE, NO SECRETS. A visual change touches neither.
  case "$c" in
    *"psql"*|*"prisma"*|*"pg_dump"*|*"pg_restore"*|*"migration.sql"*|\
    *"_prisma_migrations"*)                                          return 1 ;;
    *"DATABASE_URL="*|*"REDIS_URL="*|*"S3_"*"="*|*"JWT_SECRET="*|\
    *"REFRESH_TOKEN_SECRET="*|*"SMTP_PASS"*|*"db.pw"*)               return 1 ;;
    *"/opt/annoupale/config/"*)                                      return 1 ;;
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
    *"named"*|*"bind9"*|*"/etc/hosts"*)                             return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)    return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*)                         return 1 ;;
    *"docker"*|*"mc "*|*"tailscale up"*|*"livekit"*)                return 1 ;;
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"halt"*)                  return 1 ;;
  esac
  # Separated flags are the same command: "rm -r -f" slipped past a check
  # that only looked for the joined forms.
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1
  if [[ "$c" == *"rm "* ]]; then
    case "$c" in *" -r"*|*" -R"*|*"--recursive"*) return 1 ;; esac
  fi

  # 7. ELEVATION TARGET — the annoupale service account only.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 8. PM2 — the WEB process may restart; the API may only be READ.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*)      : ;;
      *"pm2 restart annoupale-web"*|*"pm2 start annoupale-web"*)     : ;;
      *) return 1 ;;
    esac
    case "$c" in
      *"pm2 kill"*|*"pm2 delete"*|*"pm2 unstartup"*|*"pm2 reload"*|\
      *"pm2 restart all"*|*"pm2 restart annoupale-api"*|\
      *"pm2 stop"*) return 1 ;;
    esac
  fi

  # 9. FILESYSTEM SCOPE — the app tree only, never the config dir (rule 3).
  case "$c" in
    *"tee "*|*"chmod"*|*"chown"*|*"install "*|*" > "*|*" >> "*|*"cp "*|\
    *"mv "*|*"sed -i"*|*"mkdir"*|*"shred"*|*"truncate"*|*"rm "*)
      case "$c" in
        *"/opt/annoupale/app"*) : ;;
        *) return 1 ;;
      esac ;;
  esac

  return 0
}
```

Dispatch line:

```bash
  elif vm113_annoupale_auth_deploy "$CMD"; then
    : # permitted: VM113 web-only deploy of 05fd499, per Bonex 2026-09-06.
      # TEMPORARY — remove once the deploy is verified.
```

## Procedure

1. Record the API pid + restart count, and the current `BUILD_ID`.
2. Fetch, detach to the full SHA, assert HEAD and a clean tree.
3. `npm run build:web` with `NEXT_PUBLIC_API_URL` **unset** — the same rule that
   keeps the realtime socket same-origin; setting it re-breaks that.
4. Assert 0 browser chunks carry a private address, **before** restarting.
5. Copy `static` and `public` into the standalone tree **additively**.
6. Restart the web process only. Assert the API pid and restart count unchanged.
7. Verify all six auth pages, responsive widths, no horizontal overflow, and the
   served `BUILD_ID` — through the **real domain**, since it is live.
8. Remove this exception and prove it blocks again.

Then your own visual pass on `https://annoupale.com/signin` and `/signup` is the
final acceptance. Nothing here substitutes for that.
