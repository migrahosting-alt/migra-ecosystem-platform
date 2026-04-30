# Hetzner Migration Audit

Date: 2026-04-16
Scope: repository-only audit of infrastructure references, deployment docs, monitoring scripts, and NGINX configs.

## Verdict

The repository does not reflect the current Hetzner topology you described. There is clear drift between the repo's canonical infrastructure references and the current live layout.

Most drift falls into two groups:

1. Stale documentation and runbooks that still describe the older topology.
2. Active-looking NGINX and monitoring configs that still point at older Tailscale IPs and merged roles.

## Expected Current Topology

Based on the user-provided server inventory:

| Role | Host | Tailscale IP | Notes |
|---|---|---:|---|
| app | `app-core` | `100.101.3.99` | app workload host |
| cloud | `cloud-core` | `100.113.190.42` | now on Hetzner |
| db | `db-core` | `100.77.51.91` | PostgreSQL |
| dns | `dns-core` | `100.126.11.116` | primary DNS |
| mail | `mail-core` | `100.114.228.57` | standalone mail |
| panel | `migrapanel-core` | `100.68.175.27` | panel/API host |
| edge proxy | `nginx-proxy-core` | `100.101.106.88` | lone NGINX/proxy server |
| dns failover | `ns2` | redacted in screenshot | failover DNS server |
| voice | `voip-core` | `100.111.4.85` | appears unchanged |

## Repo Canonical Topology Still Assumed

The repo still treats this older layout as canonical:

| Role | Host | IP |
|---|---|---:|
| edge proxy | `srv1-web` | `100.68.239.94` |
| panel | `migrapanel-core` | `100.119.105.93` |
| db | `db-core` | `100.98.54.45` |
| cloud | `cloud-core` | `100.120.118.39` |
| mail + dns | `dns-mail-core` | `100.81.76.39` |
| mail legacy | `mail-core` | `100.64.119.23` |
| dns legacy | `dns-core` | `100.73.241.82` |

Primary evidence:

- `.migra/infra.snapshot.json:4-16`
- `.migra/INFRASTRUCTURE_SETUP_GUIDE.md:348-355`
- `.migra/runbooks/ssh-access.md:3-4`

## High-Risk Findings

### 1. Canonical inventory is wrong

The main infrastructure snapshot still says DNS and mail are consolidated on `dns-mail-core`, and it still names `srv1-web` as the main gateway.

Evidence:

- `.migra/infra.snapshot.json:6-16`
- `.migra/infra.snapshot.json:29-35`

Impact:

- Any ops work that trusts the current snapshot will target the wrong hosts and IPs.
- The new `app-core`, `nginx-proxy-core`, and failover `ns2` do not exist in canonical repo inventory.

### 2. NGINX configs still proxy to old upstream IPs

Active-looking NGINX configs still point at older panel, cloud, and pilot upstreams.

Evidence:

- `infra/nginx/sites-enabled/mpanel.migrahosting.com.conf:28-39`
- `infra/nginx/sites-available/mpanel.migrahosting.com.conf:27,40,49`
- `infra/nginx/sites-available/migrapanel.com.conf:29`
- `infra/nginx/sites-available/intake.migrahosting.com.conf:19`
- `infra/nginx/sites-available/cloud.migrahosting.com.conf:30`
- `infra/nginx/migrapilot.migrateck.com.conf:3,43,52`
- `infra/nginx/pilot.migrateck.com.conf:28,35`

Observed old upstreams:

- `100.119.105.93` for panel and pilot services
- `100.120.118.39` for cloud

Impact:

- If these files are deployed as-is, requests can route to retired or incorrect hosts.
- Pilot and control-panel traffic appear especially likely to be wrong.

### 3. Mail and DNS are still modeled as merged

The repo repeatedly assumes a combined `dns-mail-core`, which conflicts with the current separate `dns-core` and `mail-core` layout plus failover `ns2`.

Evidence:

- `.migra/infra.snapshot.json:6-7,15`
- `.migra/runbooks/ssh-access.md:3-4`
- `.migra/runbooks/payment-to-provisioning-automation.md:235,254,271-272,500,532`
- `.migra/runbooks/provisioning-deployment-guide.md:32-34`

Impact:

- Provisioning docs now describe the wrong ownership boundary.
- DNS and mail automation plans are based on a topology that no longer matches production.

### 4. DNS migration snapshot still describes the Comcast/Xfinity-era transition

The DNS migration record still documents a move from on-prem/Xfinity `dns-core` to a Contabo mail host, with old glue records and older IPs.

Evidence:

- `.migra/dns-migration.snapshot.json:3-10`
- `.migra/dns-migration.snapshot.json:49-58`
- `.migra/dns-migration.snapshot.json:79-82`
- `.migra/dns-migration.snapshot.json:93-101`

Impact:

- This snapshot is now historically interesting but operationally misleading.
- It does not represent the current Hetzner DNS design or the failover `ns2` arrangement.

### 5. Monitoring and deployment scripts still target old hosts

Health checks and deploy scripts still use the pre-Hetzner addressing.

Evidence:

- `.migra/scripts/health_monitor.sh:33-38`
- `.migra/secrets-manager/deploy.sh:2,6`
- `.migra/secrets-manager/README.md:23,85`
- `.migra/INFRASTRUCTURE_SETUP_GUIDE.md:77,85,166,261,299,302,305,312`

Impact:

- Monitoring coverage is incomplete for the new topology.
- Automated or copied deploy steps can hit the wrong servers.

## Medium-Risk Findings

### 6. Runbooks still rank the old infrastructure as critical path

The setup guide still lists:

- `srv1-web` as NGINX
- `dns-mail-core` as mail + DNS
- old IPs for panel, db, and cloud

Evidence:

- `.migra/INFRASTRUCTURE_SETUP_GUIDE.md:348-355`

Impact:

- On-call response and escalation can drift toward retired infra.

### 7. Default host/IP values are stale in internal tooling

Evidence:

- `.migra/secrets-manager/sync-agent.js:22`
- `.migra/secrets-manager/vault-schema.json:70,82`

Impact:

- Defaults can silently recreate old connections during future setup work.

## Lower-Risk or Historical Drift

Some references are likely historical logs or raw capture data and should not be treated as live config by themselves:

- `.migra/raw/...`
- `.migra/scan.report.*`
- older `.bak` and backup NGINX files

They still add noise and can confuse audits, but they are not the first thing to fix.

## Quick Counts Of Stale IP Usage

Repository-wide file counts containing older key IPs:

| Old IP | Files |
|---|---:|
| `100.119.105.93` | 42 |
| `100.98.54.45` | 13 |
| `100.120.118.39` | 11 |
| `100.81.76.39` | 11 |
| `100.64.119.23` | 13 |
| `100.73.241.82` | 6 |
| `100.68.239.94` | 17 |

These counts include docs, scripts, snapshots, and some historical artifacts.

## Public DNS Spot-Check

Live `dig` checks performed on 2026-04-16 show public DNS is already pointing at Hetzner public IP space, not the older Comcast/Xfinity public IP shown in historical migration notes.

Observed results:

- `migrahosting.com NS` -> `ns1.migrahosting.com`, `ns2.migrahosting.com`
- `ns1.migrahosting.com A` -> `138.201.255.55`
- `ns2.migrahosting.com A` -> `138.201.255.35`
- `migrahosting.com A` -> `138.201.255.55`
- `mail.migrahosting.com A` -> `138.201.255.45`
- `cloud.migrahosting.com A` -> `138.201.255.55`
- `mpanel.migrahosting.com A` -> `138.201.255.55`
- `migrapanel.com A` -> `138.201.255.55`
- `pilot.migrateck.com A` -> `138.201.255.55`
- `migrapilot.migrateck.com A` -> `138.201.255.55`
- `migrahosting.com MX` -> `10 mail.migrahosting.com.`

Implication:

- Public DNS cutover appears largely complete.
- The bigger remaining problem is that repository configs, inventories, and runbooks still describe the older internal topology.

## What Is Missing From Repo Topology

The following current components are absent or not canonically represented:

- `app-core`
- `nginx-proxy-core`
- standalone `dns-core`
- standalone `mail-core`
- failover `ns2`
- updated Hetzner IPs for `migrapanel-core`, `db-core`, and `cloud-core`

## What I Can Confirm vs. What I Cannot Confirm

Confirmed from repo evidence:

- The repository has not been fully updated to the current Hetzner topology.
- There are active-looking configs that still reference older infrastructure.

Not confirmable from repo-only access:

- Whether live servers are actually routing correctly today.
- Whether ports stayed the same after migration.
- The exact failover `ns2` Tailscale IP.
- Whether `pilot` workloads belong on `app-core`, `migrapanel-core`, or both in the new design.

## Recommended Next Actions

1. Replace the repo's canonical infrastructure source with the current Hetzner topology.
2. Split all `dns-mail-core` assumptions into explicit `dns-core` and `mail-core`.
3. Introduce `nginx-proxy-core`, `app-core`, and `ns2` into inventory and runbooks.
4. Audit every active NGINX upstream before the next deployment.
5. Update monitoring and deploy scripts so they target current hosts only.
6. Mark older Comcast/Contabo/Xfinity migration snapshots as historical to avoid future operator confusion.

## Bottom Line

This migration is not fully reflected in the repository. The biggest operational risks are stale NGINX upstreams, stale monitoring/deploy targets, and canonical docs still describing the old merged mail/DNS and `srv1-web` edge layout.
