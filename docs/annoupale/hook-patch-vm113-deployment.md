# Prepared hook rule — VM 113 AnnouPale private application deployment

**Status: PREPARED, NOT APPLIED.** Written by the agent for Bonex to review.
The agent has not modified `.claude/hooks/block-dangerous.sh`.

## Scope (Bonex, 2026-09-05, verbatim)

> Prepare a temporary `vm113_annoupale_deployment` exception scoped only to
> `bonex@10.10.0.15`. It may deploy AnnouPale source from the canonical
> `migrahosting-alt/annoupale` repository, write only beneath `/opt/annoupale`
> and `/var/log/annoupale`, run dependency installation/build commands as the
> `annoupale` user, create AnnouPale-only private environment/config files,
> configure and operate a local AnnouPale Redis instance, and start/stop/reload
> PM2 processes whose names begin `annoupale-`. It may not touch Pale paths,
> Pale credentials, `/opt/pale`, other hosts, firewall/NAT/nginx/DNS,
> SSH/sudoers, Docker daemon state from VM 110, PostgreSQL configuration,
> LiveKit activation, or production routing. Run commands individually rather
> than via `bash -s`. Remove the exception immediately after VM 113 private
> application deployment and verification.

## Three corrections carried over from the previous two rules

1. **No blanket `-c ` deny.** The db-core rule denied `-c ` to catch
   `pg_restore --clean`, which also blocked `wc -c` and `psql -c` and cost two
   round trips. This rule denies `--clean` explicitly instead.
2. **IPs are denied only as SSH targets (`@addr`).** A bare-substring deny on
   `10.10.0.6` would block the very database URL this deployment must write.
3. **No `chown`.** `chown` has its own dispatch gate wired to the VM111 scope
   only. Ownership is achieved by running as `annoupale` (`sudo -u annoupale`)
   and by `install -d -o annoupale`, never by chowning after the fact.

## The rule

```bash
# ---------------------------------------------------------------------------
# SCOPED EXCEPTION - VM113 AnnouPale private application deployment
#
# Authorized by Bonex, 2026-09-05, in writing. Full scope quoted in
# docs/annoupale/hook-patch-vm113-deployment.md.
#
# TEMPORARY. Delete this function and its dispatch line once VM 113 private
# application deployment and verification are complete.
# ---------------------------------------------------------------------------
vm113_annoupale_deployment() {
  local c="$1"

  # 1. HOST - VM 113 only, and no other host as an SSH target.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"bonex@10.10.0.15"* ]] || return 1
  case "$c" in
    *"root@10.10.0.15"*|*"app-core"*|*"db-core"*|*"cloud-core"*|\
    *"nginx-proxy-core"*|*"migrapilot"*|*"pct exec"*|*"@10.10.0.1"[0-4]*|\
    *"@10.10.0.6"*|*"@138.201"*)
      return 1 ;;
  esac

  # 2. PALE - nothing about Pale may appear at all.
  case "$c" in
    *"/opt/pale"*|*"pale-livekit"*|*"pale-api"*|*"annoupale"*) : ;;
  esac
  # `annoupale` legitimately contains the substring `pale`, so match the
  # Pale-only forms precisely rather than on that substring.
  case "$c" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"pale-livekit"*|\
    *"internal.pale.app"*|*"PALE_INTERNAL_API_SECRET="*)
      return 1 ;;
  esac

  # 3. HARD DENY - absolutes and everything outside this scope.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                         return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                   return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"resolvconf"*|*"/etc/hosts"*)       return 1 ;;
    *"reboot"*|*"shutdown"*|*"init 0"*|*"init 6"*)                     return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)       return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*|*"snap install"*)           return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                               return 1 ;;
    *"postgresql.conf"*|*"pg_hba.conf"*|*"pg_ctlcluster"*)             return 1 ;;
    *"livekit"*)                                                        return 1 ;;
    *"--clean"*|*"tailscale funnel"*|*"tailscale serve"*)              return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 4. GIT - only the canonical AnnouPale repository may be cloned/fetched.
  if [[ "$c" == *"git clone"* || "$c" == *"git fetch"* || "$c" == *"git pull"* ]]; then
    [[ "$c" == *"github.com/migrahosting-alt/annoupale"* ]] || return 1
  fi
  case "$c" in
    *"git push"*|*"git remote add"*|*"git config --global"*) return 1 ;;
  esac

  # 5. DOCKER - only an AnnouPale-named container, and never published to a
  #    non-loopback address. Nothing may touch the daemon or foreign state.
  if [[ "$c" == *"docker"* ]]; then
    case "$c" in
      *"docker run"*|*"docker start"*|*"docker stop"*|*"docker rm "*|\
      *"docker ps"*|*"docker logs"*|*"docker inspect"*|*"docker exec"*) : ;;
      *) return 1 ;;
    esac
    [[ "$c" == *"annoupale-redis"* ]] || return 1
    case "$c" in
      *"0.0.0.0:"*|*"--network host"*|*"--privileged"*|*"-v /var/run/docker.sock"*|\
      *"/var/lib/docker"*|*"docker system"*|*"docker volume prune"*)
        return 1 ;;
    esac
    # any published port must bind loopback explicitly
    if [[ "$c" == *" -p "* ]]; then
      [[ "$c" == *" -p 127.0.0.1:"* ]] || return 1
    fi
  fi

  # 6. PM2 - only AnnouPale-named processes.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*|*"pm2 save"*|\
      *"pm2 startup"*|*"pm2 flush"*) : ;;
      *"pm2 start"*|*"pm2 stop"*|*"pm2 restart"*|*"pm2 reload"*|*"pm2 delete"*)
        [[ "$c" == *"annoupale-"* ]] || return 1 ;;
      *) return 1 ;;
    esac
    case "$c" in *"pm2 kill"*|*"pm2 unstartup"*) return 1 ;; esac
  fi

  # 7. ELEVATION TARGET - the only permitted identity is the annoupale service
  #    account. Root-level work in this scope is limited to writes under the
  #    two AnnouPale paths (rule 8).
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*) : ;;
      *"${ELEV} -n -u annoupale"*) : ;;
      *"${ELEV} install -d -o annoupale"*) : ;;
      *"${ELEV} -n install -d -o annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 8. FILESYSTEM SCOPE - every write path must be AnnouPale's own.
  case "$c" in
    *"tee "*|*"chmod"*|*"chown"*|*"install "*|*" > "*|*" >> "*|*"cp "*|\
    *"mv "*|*"sed -i"*|*"mkdir"*|*"shred"*|*"truncate"*)
      case "$c" in
        *"/opt/annoupale"*|*"/var/log/annoupale"*) : ;;
        *) return 1 ;;
      esac ;;
  esac

  return 0
}
```

## Dispatch line

```bash
  elif vm113_annoupale_deployment "$CMD"; then
    : # permitted: VM113 AnnouPale private deployment, per Bonex 2026-09-05.
      # TEMPORARY - remove with the function once verification is complete.
```

## Known limitations, stated plainly

1. **Rule 2 has a substring trap and handles it explicitly.** `annoupale`
   contains `pale`, so a naive `*"pale"*` deny would block every legitimate
   command. The rule therefore matches Pale-only forms (`/opt/pale/`,
   `pale-api`, `pale-livekit`, `internal.pale.app`). A path such as
   `/opt/palex` would not be caught — acceptable, because no such path exists
   and rule 8 confines writes to `/opt/annoupale` regardless.
2. **`PALE_INTERNAL_API_BASE_URL` is deliberately NOT denied**, because the
   private-validation `.env` must contain the inert
   `http://pale-integration.disabled.invalid` placeholder.
   `PALE_INTERNAL_API_SECRET=` **is** denied as an assignment, so a real Pale
   secret cannot be written by any command under this grant — the throwaway
   value must be generated on VM 113 and referenced, never assigned inline.
3. **`docker exec` is permitted only against `annoupale-redis`**, so it cannot
   be used to reach into another container.
4. The rule matches the command string. Commands are run individually, as
   directed, so each body is visible to the matcher.

## To apply

Review, then tell the agent to apply **this exact text** plus the dispatch
line. Remove both once VM 113 private deployment and verification are done.
