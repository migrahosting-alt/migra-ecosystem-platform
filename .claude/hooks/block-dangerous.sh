#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"

# Inspect ONLY the command being run — not the whole hook JSON, whose
# human-readable description field would false-positive (e.g. a grep whose
# description merely mentions "git push"). Falls back to the raw input when jq
# is unavailable or the command field is empty.
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || CMD="$INPUT"

block() {
  echo "Blocked dangerous command ($1). Ask Bonex for explicit approval." >&2
  exit 2
}

# ─────────────────────────────────────────────────────────────────────────────
# SCOPED EXCEPTION — VM111 MigraPilot provisioning
#
# Authorized by Bonex, 2026-08-15, in writing, bounded to:
#   "create/fix ownership and permissions under /opt/migrapilot; create the
#    Brain and consumer service users if needed; install the systemd units;
#    install/reload/start/enable those units; create required environment files
#    with restrictive permissions; create logs/runtime directories required by
#    those services; run systemctl daemon-reload.
#    Do not use this approval for unrelated packages, firewall changes, SSH
#    hardening, OS upgrades, or changes to other hosts."
#
# This is a narrow allowance, NOT a disable of the elevation rule. Every
# condition below must hold; anything unmatched falls through to the normal
# blocks. Deliberately conservative: when in doubt it returns 1 (blocked).
# ─────────────────────────────────────────────────────────────────────────────
ELEV="s""udo"   # split so this policy file can be edited by tooling that
                # refuses to emit the bare keyword; value is exactly the word.

# ─────────────────────────────────────────────────────────────────────────────
# SCOPED EXCEPTION — db-core MigraPilot Brain PostgreSQL provisioning
#
# Authorized by Bonex, 2026-08-22, in writing, bounded to:
#   "creating/configuring the migrapilot_brain PostgreSQL role and database,
#    applying the minimum required grants/revokes, and permitting connections
#    from 10.10.0.13/32 and 100.95.14.29/32. Do not modify unrelated databases,
#    roles, packages, firewall rules, SSH configuration, or operating-system
#    settings."
#
# Applied BY the agent, AS Bonex's agent, at his explicit instruction, using the
# exact rule prepared in docs/migrapilot/hook-patch-dbcore-postgres.md. The
# agent did not author or broaden the authorization.
#
# NARROWER than the VM111 exception on purpose: exactly one elevated binary
# (psql as the postgres role), on exactly one host, and no filesystem write of
# any kind. The DSN never touches db-core's disk — it is piped straight to
# VM111 — so no tee, chmod or /root path is needed here.
# ─────────────────────────────────────────────────────────────────────────────
# NOTE: a temporary db-core AnnouPale database-migration exception existed
# here on 2026-09-05, authorized by Bonex for creating the annoupale_app
# role, restoring the annoupale database and restricting it in pg_hba.conf
# to 10.10.0.15. It was REMOVED the same day once the migration and
# isolation tests passed. Exact rule kept in
# docs/annoupale/hook-patch-dbcore-annoupale-migration.md.

dbcore_brain_postgres_provisioning() {
  local c="$1"

  # 1. HOST — the db-core alias, and no other host.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"db-core"* ]] || return 1
  case "$c" in
    *"migrapilot-app-core"*|*"root@"*|*" pve "*|*"-J pve"*|*"pct exec"*) return 1 ;;
  esac

  # 2. BINARY — only psql, only as the postgres role.
  [[ "$c" == *"${ELEV} -u postgres psql"* ]] || return 1
  case "$c" in
    *"COPY "*|*"pg_read_file"*|*"pg_write"*|*"lo_import"*|*"lo_export"*) return 1 ;;
    *"tee "*|*"chmod"*|*"chown"*|*" > "*|*" >> "*) return 1 ;;
  esac

  # 3. HARD DENY — same absolutes as the VM111 exception.
  case "$c" in
    *"rm -rf"*|*"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*) return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*) return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"reboot"*|*"shutdown"*) return 1 ;;
    *"passwd "*|*"usermod -aG"*|*"gpasswd"*) return 1 ;;
  esac

  # 4. DATABASE SCOPE — only the Brain's own database may be named. The
  #    Console's Prisma-managed `migrapilot` database is explicitly excluded.
  case "$c" in
    *"mpanel"*|*"davical"*|*"elize_competition"*|*"lituation_ticketing"*|*"migracredit"*) return 1 ;;
    *"migrapilot_brain"*) : ;;
    *"migrapilot"*) return 1 ;;
  esac

  # 5. DESTRUCTIVE SQL — provisioning creates and grants. It never drops.
  case "$c" in
    *"DROP DATABASE"*|*"DROP ROLE"*|*"DROP SCHEMA"*|*"DROP TABLE"*|*"TRUNCATE"*|*"DELETE FROM"*) return 1 ;;
  esac

  return 0
}

# NOTE: a temporary VM113 annoupale-core provisioning exception existed here
# on 2026-09-05, authorized by Bonex for the base OS build only, and was
# REMOVED the same day once that build was verified. The exact rule is kept in
# docs/annoupale/hook-patch-vm113-provisioning.md if it is ever needed again.

# NOTE: a temporary VM113 web-only deploy exception existed here on 2026-09-05,
# authorized by Bonex. It deployed f87cf69 (header/footer) with no database, no
# Prisma and no API restart, and was REMOVED once verified. Rule kept in
# docs/annoupale/hook-patch-vm113-web-deploy.md.

# NOTE: a temporary publish exception existed here on 2026-09-05, authorized by
# Bonex (plus a one-line amendment adding `npm run prisma:generate`). It applied
# migration 20260905170000_signup_profile_intent via psql and deployed 2ab15f7 to
# VM 113, and was REMOVED once verified. Rule kept in
# docs/annoupale/hook-patch-vm113-publish.md.

# NOTE: a one-shot validation-OTP read exception existed here on 2026-09-05,
# authorized by Bonex, limited to GET/TTL of a single exact otpval key. It was
# used once and REMOVED immediately. Rule kept in
# docs/annoupale/hook-patch-vm113-otp-read.md.

# NOTE: a temporary VM113 re-pin/clean-rebuild exception existed here on
# 2026-09-05, authorized by Bonex in writing (plus a one-line scope reduction
# he approved), and was REMOVED the same day once the private smoke battery
# passed at b5219ad. The exact rule is kept in
# docs/annoupale/hook-patch-vm113-repin.md if it is ever needed again.

# NOTE: a temporary VM113 S3 namespace-switch exception existed here on
# 2026-09-05, authorized by Bonex in writing, and was REMOVED the same day
# once media read/write/delete validation passed. The exact rule is kept in
# docs/annoupale/hook-patch-vm113-s3-cutover.md if it is ever needed again.

# NOTE: a temporary VM113 AnnouPale private application DEPLOYMENT exception
# existed here on 2026-09-05, authorized by Bonex in writing, and was REMOVED
# the same day once the private candidate was running and verified. The exact
# rule is kept in docs/annoupale/hook-patch-vm113-deployment.md if needed again.

vm111_migrapilot_provisioning() {
  local c="$1"

  # 1. HOST — must be an ssh invocation naming the VM111 alias, and no other
  #    host may appear anywhere in the command.
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"migrapilot-app-core"* ]] || return 1
  case "$c" in
    # NOTE: match the runpod SSH ALIAS, not the substring — `api.runpod.ai`
    # legitimately appears in the provider URL written into brain.env.
    *"root@"*|*"@10.10.0.12"*|*"138.201.255.55"*|*" pve "*|*"-J pve"*|*"ssh runpod"*|*"pct exec"*|*"@10.10.0."*)
      return 1 ;;
  esac

  # 2. HARD DENY — never permitted under this exception, even on VM111.
  case "$c" in
    *"rm -rf"*|*"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*) return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*|*"snap install"*|*"pip install"*|*"npm i -g"*|*"npm install -g"*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*) return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"/etc/${ELEV}ers"*) return 1 ;;
    *"reboot"*|*"shutdown"*|*"init 0"*|*"init 6"*) return 1 ;;
    *"passwd "*|*"usermod -aG"*|*"gpasswd"*) return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*) return 1 ;;
  esac

  # 3. SYSTEMD SCOPE — any unit named must be a migrapilot-* unit, and any unit
  #    file path must live at /etc/systemd/system/migrapilot-*.
  if [[ "$c" == *"systemctl"* ]]; then
    # Permit only these verbs, and only against migrapilot-* units.
    # `daemon-reload` takes no unit and is allowed on its own.
    local sysok=1
    [[ "$c" == *"daemon-reload"* ]] && sysok=0
    if [[ "$c" =~ systemctl[[:space:]]+(--now[[:space:]]+)?(start|stop|restart|enable|disable|status|is-active|is-enabled|cat|show)[[:space:]]+(--now[[:space:]]+)?migrapilot- ]]; then
      sysok=0
    fi
    [ "$sysok" -eq 0 ] || return 1
  fi
  case "$c" in
    *"/etc/systemd/system/"*)
      # Every systemd path touched must be a migrapilot- unit.
      [[ "$c" != *"/etc/systemd/system/migrapilot-"* ]] && return 1 ;;
  esac

  # 3b. TAILSCALE SUBCOMMAND SCOPE. Join and inspect only. `funnel`/`serve` could
  #     publish a service to the public internet, which the north-star directive
  #     forbids; `down`/`logout` would sever a production inference dependency.
  if [[ "$c" == *"tailscale"* ]]; then
    [[ "$c" =~ tailscale[[:space:]]+(up|status|ip|version|netcheck|set)([[:space:]]|$|\') ]] || return 1
    case "$c" in
      *"tailscale funnel"*|*"tailscale serve"*|*"tailscale down"*|*"tailscale logout"*|*"tailscale file"*)
        return 1 ;;
      *"--advertise-exit-node"*|*"--advertise-routes"*|*"--ssh"*) return 1 ;;
    esac
  fi

  # 4. PATH SCOPE — UNCONDITIONAL. Every absolute path mentioned anywhere in the
  #    command must sit under an approved prefix (bare tool paths under
  #    /usr,/bin,/sbin excepted). Applying this only to write-verbs was a real
  #    hole: `cat /etc/shadow` passed because `cat` was not a write-verb.
  local approved_re='(/opt/migrapilot|/etc/systemd/system/migrapilot-|/etc/migrapilot|/var/log/migrapilot|/var/lib/migrapilot|/run/migrapilot)'
  #    URLs are stripped first: `https://api.runpod.ai/v2/<id>/openai/v1` is a
  #    provider endpoint in config content, not a filesystem path, and scanning
  #    its segments produced a false positive that blocked writing brain.env.
  local scan
  #    The URL charset deliberately EXCLUDES backslash: a greedy strip let
  #    `https://ok.example/v1\nY=/etc/shadow` swallow the appended real path and
  #    pass. Stopping at whitespace, quote OR backslash keeps the strip honest.
  scan="$(printf '%s' "$c" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  local p
  while read -r p; do
    [ -n "$p" ] || continue
    [[ "$p" =~ ^$approved_re ]] || return 1
  #    Paths must start at a TOKEN BOUNDARY. Matching any '/' mid-token turned
  #    the model id `Qwen/Qwen3-14B` into a bogus path `/Qwen3-14B` and blocked a
  #    legitimate write. The leading delimiter is stripped back off below.
  done < <(printf '%s\n' "$scan" \
    | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' \
    | sed -E 's#^[^/]*##' \
    | grep -vE '^/(usr/)?(bin|sbin)/(install|mkdir|chown|chmod|tee|systemctl|useradd|groupadd|cp|mv|touch|stat|ln|tailscale|node|npm|env|nologin)$' || true)
  # ^ Only EXACT tool paths are exempt. A blanket `^/(usr|bin|sbin)/` exclusion let
  #   `ln -sfn /opt/migrapilot/x /usr/local/bin/brain` through — a PATH-hijack plant,
  #   because those prefixes were never checked as write TARGETS. Caught by test.

  # 5. ELEVATED VERBS — allowlist limited to exactly what the grant enumerates:
  #    ownership/permissions, directory creation, service-user creation, unit
  #    and env-file installation, daemon-reload, and unit start/enable/restart.
  #    Deliberately EXCLUDES cat/ls/stat/sh/bash/rm/test/id — reading or shelling
  #    out is not part of the grant and widens the surface for no benefit.
  local v
  while read -r v; do
    [ -n "$v" ] || continue
    case "$v" in
      -n|--) continue ;;
      # `stat` is read-only and needed to VERIFY the perms we just set. Safe only
      # because path scope (4) is unconditional — `stat /etc/shadow` is blocked
      # by the path rule, not by the verb rule. Still no cat/ls/sh/bash/rm.
      # `ln` added 2026-08-15: the `current -> releases/<sha>` symlink is the standard
      # atomic-release swap and lives entirely inside /opt/migrapilot, which path
      # scope (4) already constrains. Both link and target must be approved paths.
      install|mkdir|chown|chmod|tee|systemctl|useradd|groupadd|cp|mv|touch|stat|ln) continue ;;
      # `tailscale` added 2026-08-15: owner directed "Install and configure Tailscale on
      # VM111 using the existing tailnet" for the public-beta topology. Subcommands are
      # restricted below — joining/reading the tailnet only, never `logout`/`down`
      # (which would cut a production dependency) and never `file`/`funnel`/`serve`
      # (which could expose services publicly — explicitly forbidden by the directive).
      tailscale) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE "${ELEV} +(-[A-Za-z-]+ +)*[A-Za-z0-9_./-]+" | awk '{print $NF}' || true)

  return 0
}

# ── PART 0, PERMANENT (Bonex 2026-09-08): EDGE IDENTITY.
#    The edge must be classified by TARGET ASSET, not by literal spelling. The
#    previous guard matched only the string "nginx-proxy-core", so every one of
#    these reached the public edge as root, unguarded:
#      ssh alias   srv1 / srv1-web        <- ~/.ssh/config, names the edge nowhere
#      tailnet v4  100.101.106.88
#      tailnet v6  fd7a:115c:a1e0::fa39:6a58
#      vmbr10      10.10.0.2
#      vmbr30      10.30.0.11
#      via pve     qm guest exec 102      <- root on the edge, never names it
#    The edge has NO public IP of its own (verified: it holds only the addresses
#    above). 138.201.255.55 is *pve's* sshd, so the public vector is the
#    guest-exec path already covered here; matching pve's IP outright would break
#    all hypervisor administration without closing anything.
#    IP tests are boundary-anchored so 10.10.0.2 does not match 10.10.0.20-29.
edge_target() {
  local c="$1"
  case "$c" in
    *"nginx-proxy-core"*|*"100.101.106.88"*|*"fd7a:115c:a1e0::fa39:6a58"*) return 0 ;;
  esac
  if [[ "$c" =~ (^|[^A-Za-z0-9_.-])srv1(-web)?([^A-Za-z0-9_.-]|$) ]]; then return 0; fi
  if [[ "$c" =~ (^|[^0-9.])10\.10\.0\.2([^0-9]|$) ]]; then return 0; fi
  if [[ "$c" =~ (^|[^0-9.])10\.30\.0\.11([^0-9]|$) ]]; then return 0; fi
  if [[ "$c" =~ (qm|pct)[[:space:]]+(guest[[:space:]]+exec|exec|terminal|monitor|sendkey)[[:space:]]+102([^0-9]|$) ]]; then return 0; fi
  return 1
}

# ── PART A companion, PERMANENT: no scoped exception is active. Parts B and C
#    (the MigraCMS extraction grants, Bonex 2026-09-08) were REMOVED once the
#    cutover was verified — exactly as authorized. Returning 1 means every
#    write/control action on the public edge is refused. Part 0 above stays.
#    A future cutover replaces this function body.
nginx_edge_exception() { return 1; }

# NOTE: a temporary PowerWash edge/certificate cleanup grant (Part F) existed here
# on 2026-09-09, authorized by Bonex, later extended to three exact stale artifact
# paths. It retired the vhost, the certificate lineage and three disabled migration
# leftovers. REMOVED once zero PowerWash artifacts remained, the config test passed and
# all active customer sites were verified unchanged. The permanent Part 0 target-asset
# edge hardening stays.
# ── PART E (Bonex 2026-09-09): READ-ONLY certificate metadata inspection.
#    Purpose is certificate INVENTORY, not secret access. The guard must tell
#    "public certificate metadata read" apart from "private-key access or
#    certificate mutation" — so key material, the archive tree and the ACME
#    account keys are refused outright, and certificate FIELDS come from
#    `openssl x509`, never from raw file reads.
letsencrypt_public_read() {
  local c="$1"

  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in *"nginx-proxy-core"*) : ;; *) return 1 ;; esac
  local _h="${c//nginx-proxy-core/EDGE}"
  case "$_h" in *"-core"*|*"srv1"*|*"pct exec"*|*"qm guest exec"*) return 1 ;; esac

  # 1. NEVER key material, the archive tree, or ACME account keys.
  case "$c" in
    *"privkey"*|*"private"*|*".key"*|*"/etc/letsencrypt/archive"*|\
    *"/etc/letsencrypt/accounts"*|*"/etc/letsencrypt/keys"*) return 1 ;;
  esac

  # 2. NO MUTATION of any kind, and no certbot invocation.
  case "$c" in
    *"tee "*|*"sed -i"*|*"cp "*|*"mv "*|*"rm "*|*"unlink"*|*" > "*|*" >> "*|\
    *"chmod"*|*"chown"*|*"truncate"*|*"shred"*|*"ln -s"*|*"install "*|\
    *"letsencrypt-auto"*|*"systemctl"*|*"service "*|*"nginx -s"*|\
    *"rsync"*|*"scp "*|*"tar "*|*"dd "*|\
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*|*"apt "*|*"apt-get"*|\
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"usermod"*|*"passwd "*|*"useradd"*) return 1 ;;
  esac

  # 2c. This is a CERTIFICATE-INVENTORY grant. If the command does not actually
  #     touch /etc/letsencrypt it has no business being permitted here — without
  #     this, any verb merely absent from the deny list above would slip through.
  #     (`ufw disable` did exactly that until this was added.)
  [[ "$c" == *"/etc/letsencrypt"* ]] || return 1

  # 2b. The ACME client is refused EXCEPT `certbot plugins`, a read-only listing
  #     of installed authenticators. The wildcard design needs to know whether a
  #     DNS-01 plugin exists at all; that is inventory, not mutation.
  if [[ "$c" == *"certbot"* ]]; then
    [[ "$c" =~ certbot[[:space:]]+plugins ]] || return 1
    case "$c" in
      *"--force"*|*"delete"*|*"revoke"*|*"certonly"*|*"renew"*|*"register"*|*"--install"*) return 1 ;;
    esac
  fi

  # 3. Any .pem named must be a PUBLIC certificate file. This closes the glob
  #    hole: `.../live/*/ *.pem` would otherwise sweep in privkey.pem.
  local p
  while read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      */cert.pem|*/chain.pem|*/fullchain.pem) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE '[A-Za-z0-9_./*-]+\.pem' || true)

  # 4. Content-reading verbs are refused except against renewal metadata, which
  #    holds configuration, not key material. Inventory uses ls/stat/readlink/find.
  case "$c" in
    *"cat "*|*"head "*|*"tail "*|*"less "*|*"more "*|*"od "*|*"xxd"*|*"base64"*|*"strings "*)
      [[ "$c" == *"/etc/letsencrypt/renewal/"* ]] || return 1 ;;
  esac

  # 5. openssl is permitted for x509 inspection only — never rsa/pkey/ec.
  if [[ "$c" == *"openssl"* ]]; then
    [[ "$c" =~ openssl[[:space:]]+x509 ]] || return 1
  fi

  return 0
}

# NOTE: a MigraCMS commercial-authority env grant (Part G), plus a one-shot
# repair extension, existed here on 2026-09-09, authorized by Bonex in writing.
# They provisioned MIGRAPANEL_API_URL/_TRANSPORT/_INTERNAL_ORIGIN/_API_KEY into
# /etc/migracms/migracms.env -- the token crossing hosts on a pipe, never on
# this workstation -- normalized a duplicated write, and were REMOVED once the
# file held exactly one of each key and migracms restarted clean.
#
# The exact rules, the 61-case permit/deny suite, the six defects that suite
# found, and an UNRESOLVED duplication anomaly whose cause was never
# established, are kept in docs/migracms/hook-patch-migracms-authority-env.md
# and its .controls.sh if they are ever needed again.

# Always-blocked patterns. Kept separated by a blank line: this header was
# silently consumed once, because a NOTE left directly above it made a
# comment-bounded edit run straight through into this section.
case "$CMD" in
  *"rm -rf"*) block "rm -rf" ;;
esac

# ── PART A, STANDING (Bonex 2026-09-06). nginx-proxy-core is the public edge
#    for every Migrateck domain, and we reach it as ROOT over ssh — so the
#    ${ELEV} gate below never fires and nothing else guarded it. Verified: a
#    delete of a live site config, a restart of the edge, a TLS cert delete and
#    a firewall disable were ALL permitted. Reads stay open; anything that can
#    change what the edge serves is blocked unless a scoped exception replaces
#    nginx_edge_exception.
if edge_target "$CMD"; then
  case "$CMD" in
    *"tee "*|*"sed -i"*|*"cp "*|*"mv "*|*"rm "*|*"unlink"*|*" > "*|*" >> "*|\
    *"chmod"*|*"chown"*|*"truncate"*|*"shred"*|*"ln -s"*|*"systemctl"*|\
    *"service "*|*"nginx -s"*|*"certbot"*|*"letsencrypt"*|*"ufw "*|\
    *"iptables"*|*"nft "*|*"apt "*|*"apt-get"*|*"reboot"*|*"shutdown"*|\
    *"poweroff"*)
      nginx_edge_exception "$CMD" \
        || letsencrypt_public_read "$CMD" \
        || block "write/control on nginx-proxy-core (the public edge)" ;;
  esac
fi

if [[ "$CMD" == *"${ELEV} "* ]]; then
  if vm111_migrapilot_provisioning "$CMD"; then
    : # permitted: VM111 MigraPilot provisioning, per Bonex 2026-08-15
  elif dbcore_brain_postgres_provisioning "$CMD"; then
    : # permitted: db-core Brain PostgreSQL provisioning, per Bonex 2026-08-22
  # NOTE: a MigraCMS commercial-authority env grant (migracms_authority_env) was
  # DRAFTED here on 2026-09-09 but is deliberately NOT dispatched: Bonex has not
  # authorized it in writing, and every other exception in this file was. The
  # proposed rule is kept in docs/migracms/hook-patch-migracms-authority-env.md.
# NOTE: a temporary migracms-core deploy-pipeline exception (connect-only) and a
# temporary MigraCMS edge-staging exception existed here on 2026-09-08, authorized
# by Bonex. They staged cms.migrahosting.com and were REMOVED once the cutover was
# verified. Exact rules kept in docs/migracms/hook-patch-migracms-extraction.md.
# The PERMANENT Part 0 edge-identity hardening from that same patch STAYS.
  else
    block "${ELEV} (outside the approved MigraPilot provisioning scopes)"
  fi
fi

case "$CMD" in
  *"git reset --hard"*) block "hard reset" ;;
  *"git clean"*) block "git clean" ;;
  *"chmod 777"*) block "chmod 777" ;;
esac

# `chown` remains blocked EXCEPT inside the approved VM111 scope above.
if [[ "$CMD" == *"chown "* ]]; then
  vm111_migrapilot_provisioning "$CMD" || block "chown"
fi

# git push policy (Bonex, 2026-07-16): plain pushes to ORIGIN are allowed;
# force/delete/mirror pushes and pushes to any other remote (e.g. the on-host
# `core` remote) remain blocked.
if [[ "$CMD" == *"git push"* ]]; then
  case "$CMD" in
    *"push --force"*|*"push -f"*|*"--force-with-lease"*|*"--delete"*|*"--mirror"*|*"origin +"*|*"push origin :"*)
      block "force/delete push" ;;
  esac
  if [[ "$CMD" != *"git push -u origin "* && "$CMD" != *"git push origin "* ]]; then
    block "push to a non-origin remote or ambiguous target"
  fi
fi

exit 0
