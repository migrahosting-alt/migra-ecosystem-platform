# DRAFT — NOT APPLIED — move `annoupale.com` to VM 113

Two `proxy_pass` lines in the **active** file
`/etc/nginx/sites-enabled/annoupale.com` on `nginx-proxy-core`:

```text
line  28   location /socket.io/   10.10.0.10:3100 -> 10.10.0.15:3100
line  42   location /             10.10.0.10:3101 -> 10.10.0.15:3101
```

Nothing else in that file, and no other file anywhere, changes.

---

## 🚨 Read this first: the hook does not currently protect this host

I reach `nginx-proxy-core` **as root over ssh**, with no `sudo`. The hook's only
elevation gate is `[[ "$CMD" == *"${ELEV} "* ]]`, so it never fires there.
Verified by feeding the hook these commands directly — every one returned
**PERMITTED**:

```text
PERMITTED  sed -i on /etc/nginx/sites-enabled/annoupale.com   (edit the live edge)
PERMITTED  systemctl reload nginx
PERMITTED  systemctl restart nginx
PERMITTED  rm /etc/nginx/sites-enabled/annoupale.com          (delete a live site)
PERMITTED  certbot delete --cert-name annoupale.com           (delete a TLS cert)
PERMITTED  ufw disable                                        (disable the firewall)
```

`nginx-proxy-core` is the public edge for **every** Migrateck domain. So Part A
below is a **standing** tightening that closes this gap permanently, and Part B
is the temporary cutover exception layered on it. Without Part A, Part B is a
promise rather than a control.

---

## Part A — STANDING block (permanent; not removed after the cutover)

```bash
# ── STANDING (Bonex <date>): nginx-proxy-core is the public edge for every
#    Migrateck domain, and we reach it as root over ssh — so the ${ELEV} gate
#    never fires and nothing else guarded it. Reads stay open. Anything that
#    can change what the edge serves is blocked unless a scoped exception
#    replaces the stub below.
nginx_edge_exception() { return 1; }   # no exception active
```

placed with the other function definitions, and this placed with the other
always-blocked patterns:

```bash
if [[ "$CMD" == *"nginx-proxy-core"* ]]; then
  case "$CMD" in
    *"tee "*|*"sed -i"*|*"cp "*|*"mv "*|*"rm "*|*" > "*|*" >> "*|*"chmod"*|\
    *"chown"*|*"truncate"*|*"shred"*|*"ln -s"*|*"systemctl"*|*"service "*|\
    *"nginx -s"*|*"certbot"*|*"letsencrypt"*|*"ufw "*|*"iptables"*|*"nft "*|\
    *"apt "*|*"apt-get"*|*"reboot"*|*"shutdown"*|*"poweroff"*)
      nginx_edge_exception "$CMD" \
        || block "write/control on nginx-proxy-core (the public edge)" ;;
  esac
fi
```

## Part B — TEMPORARY exception: replace the stub with this

```bash
nginx_edge_exception() {
  local c="$1"

  # 1. HOST — the reverse proxy only, over ssh, and no second session anywhere
  #    else. Bare IPs are NOT denied here: 10.10.0.10 and 10.10.0.15 are the
  #    values being edited. What is denied is *connecting* to another host.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in *"nginx-proxy-core"*) : ;; *) return 1 ;; esac
  # Neutralise the ONE permitted host, then refuse any other "-core" that
  # survives. Listing hosts individually missed mail-core, which let an edit
  # plus a hop through; this way a new core host is denied by default.
  local _h="${c//nginx-proxy-core/EDGE}"
  case "$_h" in
    *"-core"*|*"@10.10.0."*|*"@100."*|*"@138.201"*|*"root@"*|*"-J pve"*|\
    *"ssh pve"*|*"pct exec"*|*"qm "*|*"migrapilot"*) return 1 ;;
  esac

  # 2. DENIES FIRST — never restart/stop the edge, never touch TLS/DNS/firewall.
  case "$c" in
    *"systemctl restart"*|*"systemctl stop"*|*"systemctl disable"*|\
    *"systemctl mask"*|*"nginx -s stop"*|*"nginx -s quit"*|*"service "*) return 1 ;;
    *"certbot"*|*"letsencrypt"*|*"acme"*|*".pem"*|*"openssl"*)       return 1 ;;
    *"named"*|*"bind9"*|*"/etc/hosts"*|*"resolv"*|*"nsupdate"*)      return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                 return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*|*"docker"*|*"psql"*)      return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"passwd "*) return 1 ;;
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"halt"*|*"mkfs"*|*"dd if="*) return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                             return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 3. NO OTHER SITE, AND NO SIBLING IN THE GLOB.
  #    nginx.conf does `include /etc/nginx/sites-enabled/*` with no filter, so
  #    a rollback copy left in that directory would load a SECOND annoupale.com
  #    server block — and `nginx -t` would still pass, because a duplicate
  #    server_name is only a warning. The rollback copy goes to
  #    /etc/nginx/backups/ instead.
  case "$c" in
    *"sites-available"*|*"nginx.conf"*|*"conf.d"*|*"snippets"*)      return 1 ;;
    *"sites-enabled/annoupale.com."*)                                return 1 ;;
    *"sites-enabled/livekit"*|*"sites-enabled/releases"*)            return 1 ;;
  esac

  # 4. WRITES — must name the one config file (as source or destination).
  case "$c" in
    *"tee "*|*"sed -i"*|*"cp "*|*"mv "*|*"rm "*|*" > "*|*" >> "*|*"chmod"*|\
    *"chown"*|*"truncate"*|*"shred"*|*"ln -s"*|*"mkdir"*)
      case "$c" in
        *"/etc/nginx/sites-enabled/annoupale.com"*|*"/etc/nginx/backups"*) : ;;
        *) return 1 ;;
      esac ;;
  esac

  # 4b. The ACTIVE config may be edited or copied over — never removed,
  #      renamed or replaced by a symlink. Deleting it takes annoupale.com down
  #      completely, and "names the right file" is not the same as "safe".
  case "$c" in
    *"rm "*|*"mv "*|*"truncate"*|*"shred"*|*"ln -s"*|*"unlink"*)
      case "$c" in
        *"/etc/nginx/sites-enabled/annoupale.com"*) return 1 ;;
      esac ;;
  esac

  # 5. The rollback copy is read-only for the life of this grant.
  case "$c" in
    *"annoupale.com.rollback"*)
      case "$c" in
        *"rm "*|*"mv "*|*"truncate"*|*"shred"*|*"tee "*|*"sed -i"*) return 1 ;;
      esac ;;
  esac

  return 0
}
```

## The one way this goes badly wrong

`10.10.0.10:3100` appears **four** times in this file. Only **line 28** belongs
to the `annoupale.com` server block:

| line | server block | serves | action |
|---|---|---|---|
| 28 | `annoupale.com` | AnnouPale web realtime | **change** |
| 219 | `api.annoupale.com` | `/api/statuses` for Pale clients | **leave** |
| 328 | `api.annoupale.com` | `/api/` catch-all for Pale clients | **leave** |
| 342 | `api.annoupale.com` | Pale's `/socket.io/` | **leave** |

A global `sed s/10.10.0.10:3100/10.10.0.15:3100/g` would silently repoint three
Pale routes at a host that does not serve them. **The edit must be
line-addressed, and the census below is the gate that proves it was.**

Baseline `sha256 6b0bae23d6ee4badc1f9d077365a540b1dfcadb51f3249f378b180daa2b114be`
(15,229 bytes, a real file — not a symlink):

| upstream | before | after (required) |
|---|---|---|
| `10.10.0.10:4005` | 25 | **25** (Pale backend, untouched) |
| `10.10.0.10:3100` | 4 | **3** |
| `10.10.0.10:3101` | 1 | **0** |
| `10.10.0.15:3100` | 0 | **1** |
| `10.10.0.15:3101` | 0 | **1** |

Plus `diff` must show **exactly two changed lines**, at 28 and 42.

## Out of scope — denied above

`api.annoupale.com` server block · DNS · TLS/certbot · `/beta.html` ·
`/help/account-deletion` (both served by nginx from `/var/www/annoupale`, so
they do not move) · Pale mobile backend `:4005` · VM 110 configuration · VM 113
configuration · firewall/NAT · `livekit.annoupale.com` · every other nginx site ·
`sites-available` · `nginx.conf` · `systemctl restart nginx` · deleting the
rollback copy.

## Procedure

1. **Read** the active config; assert `sha256 == 6b0bae23…` and that lines 28
   and 42 are byte-for-byte the two `proxy_pass` lines above.
2. **Rollback copy** to `/etc/nginx/backups/annoupale.com.rollback-YYYYmmdd-HHMMSS`
   (outside the include glob); `sha256sum` both to prove it is identical.
3. **Edit exactly two upstreams**, line-addressed (28, 42). No global replace.
4. **Census gate**: the five counts above, plus a 2-line diff.
   If anything differs — restore and stop.
5. `nginx -t`.
6. `systemctl reload nginx` — reload only.
7. **Verify through the real domain** `https://annoupale.com`:
   - landing 200, showing the **new** header/footer + hero
   - `/signin` 200, `/signup` 200
   - `/socket.io/?EIO=4&transport=polling` 200 with a websocket upgrade offer
   - media renders (hero, avatars, `/api/media/…`)
   - browser check: the realtime socket dials `wss://annoupale.com/socket.io/`
   - **served build identity**: `/_next/static/TmYBlklywrcA1wlKk_tbf/_buildManifest.js`
     returns 200 and VM 110's `V0QjEJeAo_GVRX96IPYtG` returns 404. This proves
     VM 113 is receiving the traffic with no log access on VM 113 at all.
8. **Pale unaffected** — after reload, `https://api.annoupale.com/api/health/`
   still answers from `:4005`, and the `10.10.0.10:4005` count is still 25.
9. **Rollback immediately if any gate fails**: copy the rollback file back,
   `nginx -t`, `systemctl reload nginx`, re-verify. VM 110 keeps serving.

## 🚨 Two prerequisites that are NOT in this grant

1. **VM 113 cannot send email.** `SMTP_HOST=smtp.invalid` on the candidate — set
   deliberately during isolation. Signup verification, password reset and every
   other transactional mail fails the moment the domain points at VM 113;
   confirmed live, a signup there returns `emailSent: false`. This is VM 113
   configuration, which you placed out of scope here, so it is a separate step —
   but it must happen **before** any public cutover.
2. **The authenticated gates cannot be proven yet.** "Verify authenticated
   action" and "verify media upload" need a signed-in user. Signin fails closed
   with `email_not_verified`, and the verification token exists only in Postgres
   (never logged — correct). Either fix (1), or re-apply the previously-approved
   `hook-patch-vm113-otp-read.md` so the private-validation OTP
   (`OTP_PROVIDER=validation`, allowlist `+15550001111`/`+15550002222`)
   can complete a sign-in.
