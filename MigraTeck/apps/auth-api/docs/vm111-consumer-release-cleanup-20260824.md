# VM111 consumer release cleanup — 2026-08-24

Audit and deletion manifest for `/opt/migrapilot/consumer/releases/` on VM111
(`migrapilot-app-core`), authorised by Bonex with an explicit keep list.

## Why

Filesystem at **96%** (55,799 MB used / 2,632 MB free of 58,447 MB) with 64
releases at ~600 MB each. Roughly five more deploys before a release fails
mid-write, and a partial write during a symlink swap is the ugly failure mode.

## Sizing — read the dedup number, not the sum

| Measure | MB |
|---|---|
| Sum of individual release sizes | 27,139 |
| Candidates measured together (dedup) | 21,159 |
| **True recoverable (all − keep)** | **20,787** |

**56,716 files carry a link count > 1**: earlier deploys hardlinked
`node_modules` between releases, so per-release `du` figures overlap. Summing
them overstates recovery by ~28%. A further **372 MB of candidate blocks are
shared with kept releases** and will not be freed. Deleting a SUBSET frees
materially less than that subset's listed sizes.

## Ordering caveat

Releases were ranked by **git commit date, not directory mtime**. `cp -a`
preserves source timestamps, so `41d195c` and `635792a` both carry an mtime of
2026-08-21 14:39 and sort among the OLDEST. Selecting "5 most recent" by mtime
would have proposed deleting the release currently serving production.

## KEEP (9)

| Release | Reason |
|---|---|
| `41d195c` | current — symlink target |
| `635792a` | immediately previous rollback target |
| `dd7d0f5` | recent known-good |
| `d043814` | recent known-good |
| `64c75b5` | recent known-good |
| `87658f5` | recent known-good |
| `96cffae` | recent known-good |
| `v30` | pinned: recorded preserved rollback/evidence target |
| `867ac0f` | pinned: owner-approved 2026-08-21 milestone deploy |

## DELETE (55, explicit names — no wildcards)

```
00f75d9 06fe8cd 1055527 1155dd9 1fedb65 25bf79f 299ea2c 470ffbc 4e5b9a4
51654a3 56de125 63ff824 6411a35 6742615 7d03417 8c06d45 91d5f8e bdef666
c7b407b c925612 d12e9e0 e6326d4 e96e7bd f871f8f fa2ae97
v1 v2 v3 v4 v5 v5b v6 v7 v8 v9 v10 v11 v12 v13 v14 v15 v16 v17 v18 v19
v20 v21 v22 v23 v24 v25 v26 v27 v28 v29
```

`v5` is included deliberately: at 111 MB against siblings of 390–500 MB it is
structurally suspect and not a trustworthy rollback artifact.

## Pre-deletion checks (all passed)

1. `current` re-resolved → `/opt/migrapilot/consumer/releases/41d195c` ✓
2. All 9 keep releases present ✓
3. Candidate manifest: exactly 55 names ✓
4. No systemd unit or symlink references any candidate ✓

## Executed 2026-08-24 — by Bonex, manually on VM111

The cleanup was run by hand rather than by the agent. `.claude/hooks/block-dangerous.sh`
blocks `rm -rf` both as a command AND as text in a command, so the agent could
neither execute the deletion nor author a script containing it. That guard was
left intact deliberately: routing around a control that exists to force a human
checkpoint on a 55-directory delete would have defeated its only purpose. Owner
ruling: *"The hook is doing exactly what it should."*

### Post-conditions — all passed

| Check | Result |
|---|---|
| `current` resolves | `releases/41d195c` — unchanged |
| Keep set intact | all **9** present |
| Remaining releases | exactly **9**, matching the keep list |
| Candidates removed | all **55**, none survived |
| `migrapilot-consumer` | active |
| `chat.migrateck.com/` and `/settings` | HTTP 200 |
| auth health suite | 8/8 |

### Space reclaimed

| | Before | After |
|---|---|---|
| Used | 55,799 MB | 35,612 MB |
| Available | 2,632 MB | 22,820 MB |
| Utilisation | **96%** | **61%** |

**Freed 20,187 MB (~19.7 GiB).** Estimate was 20,787 MB — actual came in **2.9%
under**, which is the safe direction and consistent with per-directory `du`
rounding. The number to have worried about was ~27 GB: that would have meant more
than the manifest was deleted. It was not.

### One deviation from plan

`tee /opt/migrapilot/consumer/cleanup-20260824.log` failed with **permission
denied** — that directory is root/`migrapilot`-owned and the command ran as
`bonex` without `sudo` on the `tee`. The deletion itself was unaffected (each
`sudo rm` ran independently and every one printed its `removed` line), but the
on-host log was never written. **This document is the audit record instead**,
which is the better home anyway: version-controlled, reviewable, and off the box
whose disk it describes.

## Follow-up: this will come back

At ~600 MB per release with no retention step, 96% returns in roughly thirty
deploys. The durable fix is a prune at swap time in the consumer deploy
procedure — keep N most recent plus pinned, drop the rest — so the ceiling is
never reached again. Tracked as a small maintenance slice, not done here.
