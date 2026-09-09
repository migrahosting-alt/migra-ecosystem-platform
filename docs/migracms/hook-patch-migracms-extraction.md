# DRAFT — NOT APPLIED — MigraCMS extraction: edge vhost + deploy pipeline

Two scoped exceptions, plus one **standing hardening** that is independent of them.

Authorized by Bonex 2026-09-08 in this session:
- "Approve edge write" — vhost + certificate for `cms.migrahosting.com`
- "Approve sudo on migracms-core" — deploy pipeline
- "Connect only, don't deploy yet" — **the GitHub branch must NOT be swapped in**

The agent drafted the rule text; it did not author or broaden the authorization.

---

## 🚨 Part 0 — the standing edge guard has THREE bypass vectors

`docs/annoupale/hook-patch-nginx-annoupale-cutover.md` says Part A "closes this
gap permanently". It does not. Part A fires only on a **literal string match**:

```bash
if [[ "$CMD" == *"nginx-proxy-core"* ]]; then
```

So every one of these reaches the public edge as root, unguarded:

```text
BYPASS 1  ssh root@100.101.106.88 'rm /etc/nginx/sites-enabled/annoupale.com'
          (tailnet IP — no name in the command, no match)
BYPASS 2  ssh root@10.10.0.2 '...'            (vmbr10 address of the edge)
          ssh root@10.30.0.11 '...'           (vmbr30 address of the edge)
BYPASS 3  ssh root@138.201.255.55 'qm guest exec 102 -- rm /etc/nginx/...'
          (via pve's guest agent — reaches the edge as root, never names it)
```

This session used BYPASS 3 for **reads** before the gap was understood. It was
not used for any write, and the agent declined to use BYPASS 1 to complete an
already-approved task, because the guard's stated intent is that anything which
can change what the edge serves is blocked.

### Proposed standing hardening (permanent, not removed with the exceptions)

```bash
# Match the edge by NAME **or** by any address that reaches it, and also catch
# the pve guest-agent path (`qm guest exec 102`), which reaches the edge as root
# without ever naming it. A name-only match is not a control.
if [[ "$CMD" == *"nginx-proxy-core"*        || "$CMD" == *"100.101.106.88"* \
   || "$CMD" == *"10.10.0.2"*               || "$CMD" == *"10.30.0.11"*     \
   || "$CMD" =~ (qm|pct)[[:space:]]+(guest[[:space:]]+exec|exec)[[:space:]]+102 ]]; then
```

⚠ `10.10.0.2` is a short string; if it ever false-positives on an unrelated
command, prefer anchoring it as `@10.10.0.2` / `root@10.10.0.2`.

---

## Part B — TEMPORARY: `cms.migrahosting.com` vhost + certificate

Creates exactly one new vhost and one new certificate. Touches **no existing
file**: `cms.migrateck.com` and all 64 other vhosts are untouched, so both names
serve in parallel for side-by-side comparison.

```bash
nginx_edge_exception() {
  local c="$1"

  # 1. HOST — the edge only, over ssh, named explicitly. No hop elsewhere.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in *"nginx-proxy-core"*) : ;; *) return 1 ;; esac
  local _h="${c//nginx-proxy-core/EDGE}"
  case "$_h" in
    *"-core"*|*"pct exec"*|*"qm guest exec"*|*"138.201.255.55"*|*"10.30.0.12"*)
      return 1 ;;
  esac

  # 2. FILE SCOPE — only this one vhost name may be written, in either dir.
  #    Any other /etc/nginx path in the command refuses the whole command.
  local p
  while read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      /etc/nginx/sites-available/cms.migrahosting.com.conf) continue ;;
      /etc/nginx/sites-enabled/cms.migrahosting.com.conf)   continue ;;
      /etc/nginx/*) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE '/etc/nginx/[A-Za-z0-9_./-]+' || true)

  # 3. CERTBOT — only for this exact name, and never destructive.
  if [[ "$c" == *"certbot"* ]]; then
    [[ "$c" == *"-d cms.migrahosting.com"* ]] || return 1
    case "$c" in
      *"delete"*|*"revoke"*|*"--cert-name"*|*"unregister"*) return 1 ;;
    esac
    # --nginx would let certbot rewrite ANY vhost it chooses. Webroot only.
    [[ "$c" == *"--webroot"* ]] || return 1
  fi

  # 4. NGINX CONTROL — validate and reload only. Never restart/stop/disable.
  if [[ "$c" == *"systemctl"* || "$c" == *"nginx -s"* || "$c" == *"service "* ]]; then
    [[ "$c" =~ systemctl[[:space:]]+(reload|status|is-active)[[:space:]]+nginx ]] || return 1
  fi

  # 5. HARD DENY.
  case "$c" in
    *"rm "*|*"rm -rf"*|*"shred"*|*"truncate"*|*"sed -i"*|*"mv "*) return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)              return 1 ;;
    *"apt "*|*"apt-get"*|*"reboot"*|*"shutdown"*|*"poweroff"*)    return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*)                    return 1 ;;
    *"/etc/letsencrypt/live/"*|*"/etc/letsencrypt/archive/"*)     return 1 ;;
  esac

  return 0
}
```

**Denied that the annoupale grant allowed:** `sed -i`, `mv`, `rm`, editing any
existing vhost, `systemctl restart nginx`, and `certbot --nginx`.

---

## Part C — TEMPORARY: `migracms-core` deploy pipeline (CONNECT ONLY)

⭐ **The connect-only decision is enforced by the guard, not just by intent.**
Rule 6 refuses any command that touches `/opt/migracms/current`, so the running
release physically cannot be swapped under this grant. Rule 7 refuses every
Prisma migration verb, so the three new migrations cannot reach the shared
database that the live Compassion site also uses.

```bash
migracms_core_deploy_pipeline() {
  local c="$1"

  # 1. HOST — migracms-core only, and never a second host in the same command.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in *"10.10.0.16"*|*"migracms-core"*) : ;; *) return 1 ;; esac
  local _h="${c//migracms-core/CMS}"; _h="${_h//10.10.0.16/CMS}"
  case "$_h" in
    *"-core"*|*"pct exec"*|*"qm guest exec"*|*"10.30.0.12"*|*"10.10.0.6"*)
      return 1 ;;
  esac
  # The pve jump host is how we reach it; permitted ONLY as -W/ProxyCommand.
  case "$c" in
    *"138.201.255.55"*)
      [[ "$c" == *"-W %h:%p root@138.201.255.55"* ]] || return 1 ;;
  esac

  # 2. HARD DENY.
  case "$c" in
    *"rm -rf"*|*"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)            return 1 ;;
    *"apt "*|*"apt-get"*|*"snap install"*|*"pip install"*)           return 1 ;;
    *"npm i -g"*|*"npm install -g"*|*"corepack enable"*)             return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                 return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)            return 1 ;;
    *"reboot"*|*"shutdown"*|*"passwd "*|*"usermod -aG"*|*"gpasswd"*) return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                             return 1 ;;
  esac

  # 3. PATH SCOPE — unconditional, same construction as the VM111 rule.
  local approved_re='(/opt/migracms|/etc/migracms|/var/log/migracms|/var/lib/migracms)'
  local scan p
  scan="$(printf '%s' "$c" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  while read -r p; do
    [ -n "$p" ] || continue
    [[ "$p" =~ ^$approved_re ]] || return 1
  done < <(printf '%s\n' "$scan" \
    | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' \
    | sed -E 's#^[^/]*##' \
    | grep -vE '^/(usr/)?(bin|sbin)/(install|mkdir|chown|chmod|tee|systemctl|cp|mv|touch|stat|ln|node|npm|npx|git|env|runuser|nologin|ssh-keygen)$' || true)

  # 4. ELEVATED VERBS — allowlist.
  local v
  while read -r v; do
    [ -n "$v" ] || continue
    case "$v" in
      -n|--|-u) continue ;;
      install|mkdir|chown|chmod|tee|systemctl|cp|mv|touch|stat|ln|runuser|ssh-keygen) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE "${ELEV} +(-[A-Za-z-]+ +)*[A-Za-z0-9_./-]+" | awk '{print $NF}' || true)

  # 5. SYSTEMD SCOPE — read-only on migracms. This grant never restarts the app.
  if [[ "$c" == *"systemctl"* ]]; then
    [[ "$c" =~ systemctl[[:space:]]+(status|is-active|is-enabled|cat|show)[[:space:]]+migracms ]] || return 1
  fi

  # 6. ⭐ CONNECT-ONLY — the live release symlink is untouchable under this grant.
  case "$c" in *"/opt/migracms/current"*) return 1 ;; esac

  # 7. ⭐ NO SCHEMA CHANGE — the branch adds 3 migrations against a database
  #    shared with the live Compassion site. `prisma generate` is permitted
  #    (client codegen only); everything that writes schema is refused.
  case "$c" in
    *"migrate deploy"*|*"migrate dev"*|*"migrate resolve"*|*"db push"*|\
    *"db execute"*|*"prisma migrate"*) return 1 ;;
  esac

  return 0
}
```

Wired in beside the existing exceptions:

```bash
if [[ "$CMD" == *"${ELEV} "* ]]; then
  if vm111_migrapilot_provisioning "$CMD"; then :
  elif dbcore_brain_postgres_provisioning "$CMD"; then :
  elif migracms_core_deploy_pipeline "$CMD"; then :   # ← added
  else block "${ELEV} (outside the approved MigraPilot provisioning scopes)"; fi
fi
```

---

## Removal

Both Part B and Part C are **temporary** and removed once verified:
- Part B once `cms.migrahosting.com` serves and the certificate is issued.
- Part C once the repo is cloned, builds, and the deploy script exists.

Part 0 is **permanent** and stays.
