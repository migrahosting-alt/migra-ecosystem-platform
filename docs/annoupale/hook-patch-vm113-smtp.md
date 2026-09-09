# DRAFT — NOT APPLIED — point VM 113 at mail-core (`support@annoupale.com`)

Five keys in `/opt/annoupale/config/api.env` on VM 113. Nothing else in that
file, and no other file, changes.

```env
SMTP_HOST=mail.migrateck.com
SMTP_PORT=587
SMTP_USER=support@annoupale.com
SMTP_PASS=<existing support mailbox password — pasted by Bonex, never by me>
SMTP_FROM="AnnouPale <support@annoupale.com>"
```

## Verified before drafting (read-only, no credentials touched)

- `support@annoupale.com` is a **real mailbox**: `postmap -q` against
  `virtual_mailboxes.cf` returns `annoupale.com/support/`, and the Maildir
  exists on disk. So does `noreply@annoupale.com` — it would not have cost a new
  credential, noted for whenever a no-reply transactional sender is wanted.
- Submission on 587 is `smtpd_tls_security_level = encrypt` and
  `smtpd_sasl_auth_enable = yes`, offering `AUTH PLAIN LOGIN`. **Authenticated
  SMTP is mandatory** — an unauthenticated relay attempt cannot succeed.
- DKIM signs `*@annoupale.com` with selector `default`
  (`/etc/opendkim/SigningTable`), and `default._domainkey.annoupale.com` resolves
  in public DNS. Signature and published key agree.
- SPF is `v=spf1 ip4:138.201.255.45 -all` — a **hard fail** authorising only
  mail-core. This is precisely why VM 113 must relay and must never send direct:
  direct submission from `10.10.0.15` would be rejected by every receiver.
- VM 113 already reaches the relay on 587/465/25 and internally on
  `10.10.0.8:587`. **No firewall change is needed.**

## 🚨 This grant restarts the API — unlike the web deploys

`SMTP_*` is read by the API at boot, so `annoupale-api` must restart. Every
previous VM 113 grant in this programme explicitly **denied** touching the API;
this one cannot. That is a real widening of blast radius and the reason the rest
of the rule is tighter: no database, no S3, no JWT, no git, no build, no web.

## The secret never passes through me

`SMTP_PASS` is an existing credential. I do not read it, echo it, log it, place
it in a command argument, or write it to any intermediate file. Two options,
your choice:

- **(a) You paste it.** I set the four non-secret keys and leave `SMTP_PASS`
  untouched for you to fill in with an editor on VM 113. Zero exposure.
- **(b) stdin relay.** You pipe it to a here-doc'd script that reads one line
  from stdin and writes it straight into `api.env`. It never appears in `argv`,
  in shell history, or in any log. Rule 3 below enforces this by refusing any
  command containing `SMTP_PASS=` with a value attached.

```bash
vm113_annoupale_smtp() {
  local c="$1"

  # 1. HOST — VM 113 only.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in
    *"bonex@10.10.0.15"*|*"bonex@100.72.225.113"*) : ;;
    *) return 1 ;;
  esac
  case "$c" in
    *"root@"*|*"app-core"*|*"db-core"*|*"cloud-core"*|*"nginx-proxy-core"*|\
    *"mail-core"*|*"@10.10.0.10"*|*"@10.10.0.3"*|*"@10.10.0.6"*|\
    *"pct exec"*|*"qm "*|*"migrapilot"*) return 1 ;;
  esac

  # 2. PALE — neutralise our own product name first.
  local _p="${c//annoupale/OURS}"
  case "$_p" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"internal.pale.app"*) return 1 ;;
  esac

  # 3. THE SECRET NEVER APPEARS IN A COMMAND. A bare `SMTP_PASS=` with anything
  #    after it is refused; the value may only arrive over stdin.
  case "$c" in
    *"SMTP_PASS="?*) return 1 ;;
  esac

  # 4. NO DATABASE, NO OTHER SECRETS, NO BUILD, NO GIT.
  case "$c" in
    *"psql"*|*"prisma"*|*"pg_dump"*|*"_prisma_migrations"*|*"migration.sql"*) return 1 ;;
    *"DATABASE_URL="*|*"REDIS_URL="*|*"S3_"*"="*|*"JWT_SECRET="*|\
    *"REFRESH_TOKEN_SECRET="*|*"db.pw"*|*"OTP_"*"="*)                        return 1 ;;
    *"npm "*|*"npx "*|*"git "*|*"next build"*)                               return 1 ;;
  esac

  # 5. FILESYSTEM — one file.
  case "$c" in
    *"tee "*|*"sed -i"*|*"cp "*|*"mv "*|*"rm "*|*" > "*|*" >> "*|*"chmod"*|\
    *"chown"*|*"truncate"*|*"shred"*|*"ln -s"*|*"install "*|*"mkdir"*)
      case "$c" in
        *"/opt/annoupale/config/api.env"*) : ;;
        *) return 1 ;;
      esac ;;
  esac
  # ...and it may be edited or backed up, never destroyed.
  case "$c" in
    *"rm "*|*"mv "*|*"truncate"*|*"shred"*|*"ln -s"*)
      case "$c" in *"/opt/annoupale/config/api.env"*) return 1 ;; esac ;;
  esac

  # 6. HARD DENY.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                      return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)           return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"/etc/hosts"*)                   return 1 ;;
    *"passwd "*|*"usermod"*|*"adduser"*|*"useradd"*)                return 1 ;;
    *"apt "*|*"apt-get"*|*"docker"*|*"mc "*|*"tailscale up"*)       return 1 ;;
    *"reboot"*|*"shutdown"*|*"poweroff"*|*"halt"*)                  return 1 ;;
    *"curl"*"|"*"sh"*|*"wget"*"|"*"sh"*)                            return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 7. ELEVATION — the annoupale service account only.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 8. PM2 — the API restart this change requires, and nothing wider.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*)      : ;;
      *"pm2 restart annoupale-api"*)                                 : ;;
      *) return 1 ;;
    esac
    case "$c" in
      *"pm2 kill"*|*"pm2 delete"*|*"pm2 unstartup"*|*"pm2 restart all"*|\
      *"pm2 reload"*) return 1 ;;
    esac
  fi

  return 0
}
```

## Procedure

1. Back up `api.env` to `api.env.bak-YYYYmmdd-HHMMSS` (same directory, 0600).
2. Record which `SMTP_*` keys exist **by name only**; never print values.
3. Write the four non-secret keys. `SMTP_PASS` by option (a) or (b) above.
4. Assert the diff touches **only** `SMTP_HOST/PORT/USER/FROM(/PASS)` — no other
   key's name or value changed, and the file's key count is unchanged or +5.
5. `pm2 restart annoupale-api`; confirm it comes back `online` and
   `/api/health` is 200. **`annoupale-web` must not restart** — record its pid
   before and after.
6. **Delivery test**, self-contained: trigger one signup verification to a
   throwaway `@annoupale.com` probe address, then on mail-core read the
   **maillog only** — never a mailbox — for that message-id, confirming:
   `sasl_username=support@annoupale.com`, `status=sent`, and an
   `opendkim: DKIM-Signature added` line for `annoupale.com`.
7. **SPF/DKIM**: the signature is added by mail-core and the envelope leaves from
   `138.201.255.45`, which is the only IP the `-all` record authorises.
   True third-party deliverability needs one message to an external address —
   **your call**, not done under this grant.
8. **No secret in logs**: grep the API log, `api.env.bak`, and mail-core's
   maillog for the password value and assert zero hits.
9. **No direct outbound SMTP from VM 113**: assert `SMTP_HOST` resolves to
   mail-core and that nothing in `api.env` points at a public MX.
10. Remove this exception and prove it blocks again.

## Rollback

Restore `api.env.bak-*`, `pm2 restart annoupale-api`, confirm `/api/health` 200.
Mail simply returns to not sending, which is today's state — so the failure mode
of this change is exactly the status quo, not an outage.
