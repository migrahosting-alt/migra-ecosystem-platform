# Hook patch — VM102 nginx upload ceiling

## Why this exists

`chat.migrateck.com` is served by nginx on VM102 (`NGINX-PROXY-CORE`, `10.10.0.2`).
That vhost carried `client_max_body_size 32M`, which is the *entire* reason Chat
uploads failed above ~31 MB. Measured against production: **31.7 MB passes,
32.2 MB returns 413** — the config value and the observed boundary agree exactly.

Raising it requires elevation on VM102. The two existing scoped exceptions cover
VM111 and db-core only, so elevation on VM102 was blocked, correctly.

## Authorization

Bonex, in writing, 2026-08-28:

> "On VM102, update the relevant nginx client_max_body_size for the MigraPilot
>  upload path, validate nginx configuration before reload, reload without
>  disrupting unrelated services, and verify the production route."

Applied BY the agent, AS Bonex's agent, at his explicit instruction, using the
exact rule below. The agent did not author or broaden the authorization.

## Why it is shaped this way

This is the **narrowest** of the three exceptions. It permits four elevated
operations against exactly one file and one service:

| Operation | Purpose |
|---|---|
| `cp <vhost> <vhost>.bak-<ts>` | Keep the outgoing config, so reverting is a copy back |
| `tee <vhost>` | Write the new config whole, from content composed off-host |
| `/usr/sbin/nginx -t` / `-T` | Validate **before** any reload |
| `systemctl reload nginx` | Apply without dropping connections |

It deliberately does **not** permit in-place editing (`sed -i`), `mv`, deletion,
`ln`, `chmod`, `chown`, or any package/firewall/SSH operation. The new config is
composed locally and pushed whole, so a partial edit cannot leave the proxy in a
half-written state that fails to parse.

`systemctl reload` — never `restart`. Reload re-reads config and gracefully
retires old workers; the ~20 unrelated vhosts on this proxy (auth, api, console,
cms, annoupale, compassion, migracredit, …) keep serving throughout. A restart
would drop every one of them for the sake of a body-size constant.

## The route this proxy sits on

    browser → pve 138.201.255.55:443 (DNAT, L4, no body limit)
            → VM102 nginx  chat.migrateck.com   ← the ceiling lives here
            → VM111 10.10.0.13:3000 (consumer)

`chat.migrateck.com` resolves straight to the pve public IP — there is no CDN or
second proxy in front, so this vhost is the only transport-layer ceiling.
`nginx.conf` sets no http-level `client_max_body_size` and `conf.d/` is empty, so
the vhost value is not competing with a wider default.

VM102 has 9.3 GB free on `/`, which is ample for nginx buffering a 256 MB request
body to `/var/lib/nginx/body` before proxying it upstream.

## The rule as applied

    vm102_nginx_upload_ceiling()

1. **HOST** — the command must address `debian@10.10.0.2`, and must not invoke
   pve-local tooling (`pct exec`, `qm `), so the allowance cannot be spent on the
   hypervisor it transits.
2. **BINARY** — every elevated binary must be one of `cp`, `tee`,
   `/usr/sbin/nginx`, `systemctl`. Nothing else.
3. **PATH SCOPE (unconditional)** — every absolute path in the command must be
   the chat vhost, one of its timestamped backups, or `/usr/sbin/nginx`.
4. **SYSTEMD SCOPE** — only `reload`/`status`/`is-active`, only for `nginx`.
5. **NGINX FLAGS** — only `-t`, `-T`, `-v`. Never `-s stop`/`-s quit`.
6. **HARD DENY** — the same absolutes as the other two exceptions: recursive
   force deletion, `mkfs`, `dd if=`, partition tools, package managers, firewall
   tools, `/etc/ssh`, `authorized_keys`, `visudo`, reboot/shutdown, user/group
   changes.

## Reverting

    ssh root@138.201.255.55 "ssh debian@10.10.0.2 \
      '<elev> cp /etc/nginx/sites-available/chat.migrateck.com.conf.bak-<ts> \
               /etc/nginx/sites-available/chat.migrateck.com.conf \
       && <elev> /usr/sbin/nginx -t && <elev> systemctl reload nginx'"
