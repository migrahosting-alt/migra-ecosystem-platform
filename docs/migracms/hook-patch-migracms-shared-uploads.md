# Hook grants — MigraCMS release deploy (Part H) and shared uploads (Part I)

**AUTHORIZED by Bonex 2026-09-09. TEMPORARY.** Remove once the landing page is
visually accepted or rolled back.

## Part H — release deploy

Deploys an immutable commit as a NEW release beside the running one and repoints
the symlink. The release directory name is **bound at install time** to one
literal; there is no wildcard under `/opt/migracms/releases`, so a later release
needs its own grant. The rsync SOURCE is bound as a second literal.

## Part I — shared upload storage

Every mutating command is an exact whole-string literal: create the shared path,
copy the five files, rename the original aside, symlink both releases, rewrite
the one `ReadWritePaths` line, `daemon-reload`, and remove the aside copy. Reads
are scoped to `/opt/migracms/**` plus the unit file.

## 🚨 Why Part I exists: a release-architecture defect

Deploy attempt 1 crash-looped `226/NAMESPACE` — the unit declared
`ReadWritePaths=/opt/migracms/current/apps/web/public/uploads` and a Next
standalone build ships no empty `uploads/`. The missing directory was the
symptom. The defect was that **mutable tenant media lived inside an immutable
release directory**, so every atomic release switch orphaned it. Creating the
empty directory would have "worked", passed every acceptance criterion, and
silently dropped 360 KB of tenant media.

Invariant now established:

```
code releases          immutable / disposable
tenant uploads         persistent / shared
current symlink        points only at a code release
systemd writable path  points only at persistent data
```

**Permanent rule: every mutable path used by a release-based service must live
outside `/opt/migracms/releases/*`.** Check it before any future release.

## 🚨 The guard blocked its own rollback

Part H scoped every write scan to the NEW release, so the flip BACK to the old
one was refused — the remedy denied, with production already down. Fixed by
judging the exact rollback as one whole literal before the scoped scans.

**Permanent rule: every temporary deployment grant must prove both the
happy-path transition and the exact rollback transition before production is
touched.** Part I's suite does this explicitly.

## Evidence

```
uploads migrated   5 files / 360633 bytes, per-file sha256 identical,
                   modes 644, dir 755 migracms:migracms, relative paths intact
proved on          the OLD release first, before any code deploy
retrieval          all 5 fetched 200 with exact sizes and matching hashes
aside copy         removed after proof; no second media copy in the release
unit               only the ReadWritePaths value changed; every other
                   directive byte-identical at the same line numbers
suites             Part H 28/28, Part I 30/30 (incl. the rollback transition)
outage             attempt 1: 5m23s (22:31:35 - 22:36:58 UTC). Attempt 2: none.
```
