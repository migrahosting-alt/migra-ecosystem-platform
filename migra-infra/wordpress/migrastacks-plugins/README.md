# MigraStacks Enterprise WordPress Plugin Suite

First-party enterprise plugins built under MigraStacks:

- `migrastacks-core`
- `migrastacks-security`
- `migrastacks-performance`
- `migrastacks-deliverability`

## Enterprise Feature Coverage

- `migrastacks-core`
  - Centralized policy settings
  - Extended Site Health checks (HTTPS, debug posture, cron, object cache, permalinks)
  - Rolling audit log with retention and admin/CLI controls
- `migrastacks-security`
  - Configurable lockout policy
  - REST/author user-enumeration protection
  - XML-RPC hardening and security headers
  - Security lockout inventory + unlock CLI operations
- `migrastacks-performance`
  - Tunable frontend optimization policy
  - Heartbeat + revision controls
  - Scheduled transient maintenance and manual run controls
- `migrastacks-deliverability`
  - SMTP policy from constants or environment
  - Delivery telemetry (failed/success mail logs)
  - Admin + CLI test mail workflows

## Install with wp-cli

```bash
cd /path/to/migra-infra/wordpress/migrastacks-plugins
chmod +x install-migrastacks-pack.sh
./install-migrastacks-pack.sh --wp-path /var/www/html
```

Multisite network activation:

```bash
./install-migrastacks-pack.sh --wp-path /var/www/html --network
```

Install flags:

- `--no-backup` skip plugin folder backups before replacement
- `--skip-auto-updates` keep plugin auto-updates disabled
- `--hardening-baseline` apply enterprise-safe baseline settings:
  - enforce `default_role=subscriber`
  - enforce pretty permalinks only when still plain
  - verify `DISALLOW_FILE_EDIT` and warn if missing

## SMTP Configuration

Add constants from `wp-config.migrastacks-sample.php` to `wp-config.php`, or set the same keys as environment variables.

## Operational CLI Commands

```bash
wp migrastacks status --path=/var/www/html
wp migrastacks audit list --path=/var/www/html --limit=25
wp migrastacks security lockouts --path=/var/www/html
wp migrastacks security unlock --path=/var/www/html --all
wp migrastacks performance status --path=/var/www/html
wp migrastacks performance cleanup --path=/var/www/html
wp migrastacks mail status --path=/var/www/html
wp migrastacks mail logs --path=/var/www/html --limit=25
wp migrastacks mail test admin@example.com --path=/var/www/html
```
