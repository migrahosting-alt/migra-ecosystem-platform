# VM111 deployment runbook — Brain and Consumer

Production for `chat.migrateck.com`. Written after a deploy that **took the Brain down**;
the rule that would have prevented it is §4 and it is not optional.

## 0. Topology (traced, not assumed)

```
chat.migrateck.com -> 138.201.255.55 (pve)
  :443 DNAT -> 10.10.0.2 (VM102 NGINX-PROXY-CORE)
       -> VM111 migrapilot-app-core = 10.10.0.13, tailnet 100.95.14.29
```

| service | env file | serves |
|---|---|---|
| `migrapilot-brain.service` | `/etc/migrapilot/brain.env` | `127.0.0.1:3988` |
| `migrapilot-consumer.service` | `/etc/migrapilot/consumer.env` | `10.10.0.13:3000` |

Access: `ssh migrapilot-app-core` (user `bonex`, ProxyJump `pve`). Releases are symlink
swaps: `/opt/migrapilot/{brain-service,consumer}/current -> releases/<name>`.

## 1. What a release artifact contains

**Brain** — `dist/` + `package.json` + `pkgs/*.tgz`, and **no `node_modules`** (~1.7 MB).
`pkgs/` holds all five packed workspace packages: `protocol`, `shared-types`,
`pilot-client`, `agent-defs`, `workspace-tools`.

**Consumer** — `.next/` (**exclude BOTH `.next/cache` AND `.next/dev`**) + `package.json` +
`next.config.ts` + `public/`.

🚨 `.next/dev` is stale **dev-server** output. It was shipped to production in every earlier
release: 207 MB of code that `next start` never serves but that sits in the release forever,
and can contain a build older than the one being deployed. Excluding it took the artifact
from **149 MB to 3.9 MB**.

And when staging over a previous release, **move the old `.next` aside rather than laying the
new one over it** — otherwise last release's cruft outlives every deploy:

```bash
mv ~/cstage-<sha>/.next ~/cstage-<sha>/.next.old-<sha>
tar -xzf ~/consumer-release-<sha>.tgz -C ~/cstage-<sha>
``` `@migrapilot/shared-types` is imported **type-only** there, so
it is erased at build time and is not a runtime dependency.

Build from a **clean tree at a known commit**, and name the artifact after that commit.

### 🚨 DO NOT BUILD `pkgs/*.tgz` WITH `npm pack`

`npm pack` produced a package containing **one file**. The boot test caught it:

    ERR_MODULE_NOT_FOUND
    file:///home/bonex/stage-<sha>/node_modules/@migrapilot/protocol/dist/tools.js

None of these packages declare a `files` field, so npm falls back to `.gitignore` — and
`.gitignore` ignores `dist/`. npm force-includes only the file named by `main`, so the tarball
held `dist/index.js` and nothing else. It packs successfully, reports no warning, and is the
right size to look plausible. Production's own `protocol` tarball has 38 entries; the `npm pack`
one had 2.

Build them explicitly instead, keeping the `package/` root that `--strip-components=1` expects:

```bash
cd packages/<name>
tar -czf <stage>/pkgs/migrapilot-<name>-0.1.0.tgz --transform 's,^,package/,' dist package.json
```

And check the count before shipping — a package that lost its modules is not visibly different
from one that did not:

```bash
for p in protocol shared-types pilot-client agent-defs workspace-tools; do
  echo "$p: $(tar -tzf <stage>/pkgs/migrapilot-$p-0.1.0.tgz | wc -l) entries"
done
```

## 2. Install ALL FIVE workspace packages — the incident

The first Brain deploy staged by copying the previous release's `node_modules` and replacing
only `@migrapilot/shared-types`, because that was the package whose output had changed. The
service crashed on boot:

```
SyntaxError: The requested module '@migrapilot/protocol'
does not provide an export named 'GitBlameRequestSchema'
```

The new `dist` also needed a newer `protocol`. **Production was down until rollback.**

`node_modules` inherited from the previous release is a *base*, never a *finished state*.
Unpack **every** tgz in `pkgs/` over `node_modules/@migrapilot/<name>`, moving the old copy
aside first — a leftover file from the previous package silently satisfying an import is the
same failure wearing a different hat.

## 3. Stage as `bonex`, install as root

Do all assembly in `~` with no elevation, then copy the finished tree into `/opt`. Keep
elevated commands to `cp`, `chown`, `ln`, `systemctl`.

### 🚨 GATE: VERIFY ARTIFACT CONTENT — "pack succeeded" IS NOT EVIDENCE

A packaging step can exit 0, warn about nothing, and produce a **syntactically valid but
functionally empty package**. That is not hypothetical: see §1 — `npm pack` shipped
`@migrapilot/protocol` with one file out of thirty, because `.gitignore` hides `dist/`.
The tarball was well-formed. It was simply missing the code.

So the artifact is checked for CONTENT before it is booted, every time:

```bash
# Every workspace package must carry more than its entry point.
for p in protocol shared-types pilot-client agent-defs workspace-tools; do
  n=$(tar -tzf <stage>/pkgs/migrapilot-$p-0.1.0.tgz | wc -l)
  [ "$n" -ge 5 ] && echo "ok   $p ($n entries)" || echo "FAIL $p ($n entries) — STOP"
done

# And the change you are deploying must actually be in the built output.
grep -c "<a symbol from this change>" <stage>/dist/src/<the file you edited>.js
```

Both must pass before §4 runs. The boot test catches a missing module only when something
imports it on the startup path; a package that lost a lazily-imported module passes the boot
test and fails in front of a user. Content is checked because liveness cannot prove it.

## 4. BOOT-TEST ON A SPARE PORT BEFORE THE SYMLINK MOVES

**Non-negotiable. This is the rule the incident bought.**

```bash
cd ~/stage-<sha>
MIGRAPILOT_BRAIN_PORT=3999 MIGRAPILOT_STATE_DB=off node dist/src/server.js   # Brain
node node_modules/next/dist/bin/next start -p 3001 -H 127.0.0.1              # Consumer
```

### 🚨 `MIGRAPILOT_STATE_DB=off` IS NOT OPTIONAL

The spare-port run has no `brain.env`, so `NODE_ENV` and `MIGRAPILOT_PERSISTENCE`
are both unset — and the resolver's non-production default is **SQLite in the
current working directory**. The boot test therefore created a real
`migraai-state.db` inside the staging tree, and the next step, `sudo cp -r
~/stage-<sha> /opt/...`, shipped it into the release directory.

That is how two PostgreSQL candidate releases came to contain a SQLite database
they never opened. Nothing was corrupted — the file was created before the
service started and never touched afterwards — but under a PostgreSQL-only
mandate a stray SQLite database inside a release is indistinguishable, at a
glance, from a service that quietly fell back to it. Found on 2026-08-22 while
running the candidate gate's SQLite check.

`MIGRAPILOT_STATE_DB=off` makes the boot test create nothing. It does not weaken
the test: the boot test proves the process starts and serves new code, and
persistence is proven separately by the gate against the real service with its
real environment.

**Check before copying into `/opt`:**

```bash
find ~/stage-<sha> -maxdepth 1 -name 'migraai-state.db*' | grep . && echo "STOP — the boot test wrote a database"
```

The service must reach "listening" **and** answer a route that only exists in the new build:

```bash
curl -s -w '\n%{http_code}\n' http://127.0.0.1:3999/api/ai/speech/capability
```

Expect **200** with `unavailable` (the spare-port run has no `brain.env`, so no runtime is
configured). A **404 means the new code is not actually in the tree you are about to
promote.** Only after this passes may `current` move.

`systemctl is-active` is NOT a boot test: a crash-looping unit reports `activating
(auto-restart)` and will read as running if you glance at it during a restart window.

### 🚨 PROVE THE PORT IS FREE, AND THAT THE ANSWER CAME FROM YOUR CANDIDATE

A spare-port boot test is only evidence if the process answering is the build under test.
The Brain, finding its port occupied, does NOT fail — it logs

    MigraPilot brain port already in use; reusing the existing healthy local service

and serves the process already there. A stale test process left over from the PREVIOUS
deploy therefore answered a later boot test, `PUT /grounding` returned 404, and the release
looked broken when it was fine. That is a confident false negative, which is worse than no
test.

Before every boot test:

```bash
ss -lnt | grep <port> || echo FREE          # must print FREE
```

After it, prove the responder is yours:

```bash
grep -c "reusing the existing" <boot log>   # must be 0
for pid in $(pgrep -f "dist/src/server.js"); do
  echo "$pid $(readlink /proc/$pid/cwd)"    # your staging dir, not another release
done
```

Kill only YOUR leftovers. A process whose `/proc/<pid>/cwd` is unreadable belongs to another
user — that is the production service, and it must never be killed to free a test port.

## 5. Promote, then restart one service

```bash
sudo cp -r stage-<sha> /opt/migrapilot/brain-service/releases/<sha>
sudo chown -R migrapilot:migrapilot /opt/migrapilot/brain-service/releases/<sha>
sudo ln -sfn /opt/migrapilot/brain-service/releases/<sha> /opt/migrapilot/brain-service/current
sudo systemctl restart migrapilot-brain.service
```

Use a **new directory name** per attempt. Copying over a broken tree leaves stale files, and
"which files are live" must never be a guess.

**Brain first, verified independently, then the consumer.** Never one combined release: when
something breaks you need to know which half.

## 6. Secrets

Append via **stdin**, never as an argument — arguments appear in process listings and shell
history:

```bash
printf 'KEY=%s\n' "$TOKEN" | ssh migrapilot-app-core 'sudo tee -a /etc/migrapilot/brain.env | wc -c'
```

`| wc -c` rather than a redirect to the null device: `tee` echoes stdin, and `/dev/null` is
outside the hook's approved path scope. Never print a token into output, logs, commits or chat.

## 7. Verify through the PUBLIC surface

A restarted process is not a deployed build. Prove it with a route that did not exist
before:

```bash
curl -s -w ' [%{http_code}]\n' https://chat.migrateck.com/api/speech/capability
curl -s https://chat.migrateck.com/settings | grep -c 'Emma Johnson'   # must be 0
```

## 8. Rollback

Keep the previous release directory. Rollback is a symlink swap plus a restart — seconds:

```bash
sudo ln -sfn /opt/migrapilot/brain-service/releases/<previous> /opt/migrapilot/brain-service/current
sudo systemctl restart migrapilot-brain.service
```

Roll back **first**, diagnose after. Production being down while you read a stack trace is a
choice, and the wrong one.

## 9. Elevated-access scope on VM111

`.claude/hooks/block-dangerous.sh` permits elevation only in an ssh command naming the
`migrapilot-app-core` alias, only under `/opt/migrapilot`, `/etc/migrapilot`,
`/etc/systemd/system/migrapilot-*`, `/var/{log,lib}/migrapilot`, and only for write verbs
(`cp mv install mkdir chown chmod tee ln touch stat systemctl`). **Reading is deliberately
excluded** — no elevated `cat`/`ls`/`grep`/`tail`. Use `systemctl status` for logs. Two
recurring trip-ups: the null device anywhere in an elevated command is outside path scope,
and `chown user:group` without `-R` breaks the verb parser.

## 10. Known deployment risks

### 🚨 The gap between symlink promotion and process replacement

Promotion is two independent steps — `ln -sfn` then `systemctl restart` — and between them
`current` names the NEW release while the running process is still the OLD build. On
2026-08-22 that window lasted about five minutes, because the restart was refused three times
by the permission classifier while the symlink move had already gone through. Production stayed
healthy on the old build the whole time, so this cost nothing. **In a rollback it would.**

The state is also silently misleading: `ls -l current` reports the new release and
`systemctl is-active` reports `active`, and both are true while the defect you are rolling
back from is still being served. Neither answers "what is the running process actually
executing?"

So during any promotion, the running build is established from the PROCESS, never from the
symlink:

```bash
systemctl show migrapilot-brain.service -p ExecMainPID -p ExecMainStartTimestamp
# ExecMainStartTimestamp EARLIER than the symlink's mtime means the restart has not happened.
```

If a restart is refused, say so and stop — do not leave the window open silently, and never
report a release as deployed on the strength of the symlink alone.

### Rollback is a restart, not only a symlink move

For the same reason: pointing `current` back at the previous release does nothing until the
service is restarted. Both halves, or the rollback has not happened.
