# Proxmox Autostart Policy

Updated: 2026-04-06
Host: `pve` (`100.73.199.109`)

## Goal

Ensure core VMs and active service containers come back automatically after a Proxmox host reboot, accidental shutdown, or power interruption.

## Applied VM Policy

The following VMs are configured with `onboot: 1` and explicit startup order:

| Order | VMID | Name | Reason |
| --- | ---: | --- | --- |
| 10 | 106 | `db-core` | Database dependency for panel and app services |
| 20 | 103 | `CLOUD-CORE` | Object storage and backup services |
| 30 | 107 | `MigraPanel-Core` | Panel/API services after DB and storage |
| 40 | 100 | `SRV1-WEB` | Edge web tier after backend dependencies |
| 50 | 104 | `VOIP-CORE` | Independent voice services |
| 60 | 250 | `ubuntu-24-base-working` | Running non-template guest preserved for restart continuity |

The following VM is explicitly excluded from autostart:

| VMID | Name | Reason |
| ---: | --- | --- |
| 200 | `BASE-UBUNTU-24` | Template VM; should remain stopped |

## Applied LXC Policy

The following service containers are configured with `onboot: 1` and start after the VM layer:

| Order | CTID | Hostname |
| --- | ---: | --- |
| 110 | 101 | `pod-migramarket-com` |
| 120 | 137 | `pod-premtint` |
| 140 | 139 | `pod-lituationdjs` |

The following containers are explicitly excluded from autostart because they are stopped, disposable, smoke, UUID-named, or template workloads:

| CTID | Hostname |
| ---: | --- |
| 102 | `pod-7d8374ac-07bb-4e2f-906c-13f0d0f32696-migrahosting-com` |
| 105 | `pod-ff3e9efa-97e4-4cfc-b98c-42c674bd8dca-migrahosting-com` |
| 108 | `pod-smokewp-migrahosting-com` |
| 109 | `pod-ddf273c1-6e81-4360-bbae-175b3a7d3a05-migrahosting-com` |
| 110 | `pod-e2etest1773100900-migrahosting-com` |
| 111 | `pod-e2efinal1773101412-migrahosting-com` |
| 138 | `pod-holisticgroupllc` |
| 136 | `pod-elizefoundation` |
| 9000 | `cloudpod-template` |

`pod-holisticgroupllc` was removed from autostart because the customer canceled and the tenant should remain suspended. `pod-elizefoundation` was left disabled because it is currently stopped on the hypervisor. If either tenant is returned to active service later, re-enable it with an explicit startup order.

## Verification Commands

```bash
ssh pve 'for id in 100 103 104 106 107 200 250; do echo "## VM $id"; qm config "$id" | grep -E "^(name|onboot|startup):"; done'
ssh pve 'for id in 101 102 105 108 109 110 111 136 137 138 139 9000; do echo "## CT $id"; pct config "$id" | grep -E "^(hostname|onboot|startup|template):"; done'
```

## Operational Note

CloudPod provisioning should not blindly inherit `onboot: 1` for smoke, UUID, or template guests. If that behavior appears again, fix the provisioning default in the automation layer instead of repeatedly correcting guests by hand.

## Reboot Validation

Validated with a controlled Proxmox reboot on 2026-04-06.

- Core VMs recovered automatically: `100`, `103`, `104`, `106`, `107`, `250`.
- Intended service LXCs recovered automatically during reboot validation: `101`, `137`, `138`, `139`.
- Current intended autostart LXC set is `101`, `137`, `139`; `138` was removed afterward when tenant status was confirmed canceled.
- Excluded LXCs remained stopped as designed: `102`, `105`, `108`, `109`, `110`, `111`, `136`, `9000`.
- Public smoke checks after reboot returned `200` for `migrapanel.com`, `control.migrahosting.com`, `premtint.com`, and `lituationdjs.com`.
- `holisticgroupllc.com` returning `503` is expected because the tenant service was canceled and remains intentionally suspended at the live edge via `/etc/migrapanel/tenant-suspended.map`.