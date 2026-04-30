# AnnouPale Auth Staging Host Exposure Commands

This runbook exposes the staging auth pair:

- staging-auth.migrateck.com (auth web)
- staging-auth-api.migrateck.com (auth API)

It does not change auth feature code.

## 1) DNS records

At your DNS authority, create:

- A staging-auth.migrateck.com -> 138.201.255.55
- A staging-auth-api.migrateck.com -> 138.201.255.55

Optional if IPv6 is active on edge:

- AAAA staging-auth.migrateck.com -> <edge-ipv6>
- AAAA staging-auth-api.migrateck.com -> <edge-ipv6>

## 2) Install edge vhosts on nginx-proxy-core

From repository root on your workstation:

```bash
scp infra/nginx/sites-available/staging-auth.migrateck.com.conf root@100.101.106.88:/etc/nginx/sites-available/
scp infra/nginx/sites-available/staging-auth-api.migrateck.com.conf root@100.101.106.88:/etc/nginx/sites-available/

ssh root@100.101.106.88 '
  ln -sf /etc/nginx/sites-available/staging-auth.migrateck.com.conf /etc/nginx/sites-enabled/staging-auth.migrateck.com.conf &&
  ln -sf /etc/nginx/sites-available/staging-auth-api.migrateck.com.conf /etc/nginx/sites-enabled/staging-auth-api.migrateck.com.conf &&
  nginx -t
'
```

## 3) Issue TLS certs

Run on edge after DNS resolves:

```bash
ssh root@100.101.106.88 '
  certbot --nginx -d staging-auth.migrateck.com -d staging-auth-api.migrateck.com --non-interactive --agree-tos -m migrahosting@gmail.com --redirect &&
  nginx -t &&
  systemctl reload nginx
'
```

## 4) Ensure staging runtimes exist

Default upstreams in the vhosts expect:

- web runtime: 10.10.0.10:3201
- api runtime: 10.10.0.10:3200

If your staging runtime ports differ, update both vhost proxy_pass values and reload nginx.

## 5) Verify host exposure gate

From repository root:

```bash
bash apps/pale-platform/scripts/auth-staging-preflight.sh
```

Expected:

- DNS resolves for both hosts
- TLS handshake works for both hosts
- 200 on:
  - https://staging-auth.migrateck.com/login
  - https://staging-auth.migrateck.com/signup
  - https://staging-auth.migrateck.com/forgot-password
  - https://staging-auth.migrateck.com/reset-password
  - https://staging-auth-api.migrateck.com/health

## 6) Then run provider-backed staging auth pass

Only after section 5 is fully green:

1. email delivery checks
2. SMS or approved test-lane checks
3. signup, verify, login, me, refresh, logout
4. refresh-after-logout failure
5. auth_events lifecycle verification
6. evidence capture