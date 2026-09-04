# Continuous delivery for the Brain — VM111 self-hosted runner

The pipeline is `.github/workflows/deploy-brain.yml`. This is what has to exist on
the box before it can run, and why each piece is shaped the way it is.

**It is disarmed right now.** The trigger requires the ref `deploy/brain`, which does
not exist. Nothing deploys until you create it.

## 0. Why a self-hosted runner

VM111 has no inbound path — it sits behind pve and the tailnet. GitHub cannot
webhook it, and a hosted runner cannot reach it. A self-hosted runner connects
**outbound** and long-polls, so this needs no firewall change, no port forward, and
no credential of yours stored on GitHub's side.

The trade-off, stated plainly: **a self-hosted runner executes workflow code from the
repository on a production host.** Anyone who can push a workflow change can run code
as the runner user on VM111. That is acceptable for a private repo with a small
trusted team, and it is the reason for steps 2 and 3 below — the runner is an
unprivileged user that can invoke exactly one privileged command, and nothing else.

## 1-3. Install the runner  *(one command, on VM111, as root)*

Steps 1 to 3 below are automated by `scripts/install-brain-deploy-runner.sh`. It is
idempotent, and it validates the sudoers file with `visudo -c` before installing it —
a malformed one can lock everybody out of sudo on the box.

`/opt/migrapilot/bin/brain-release.sh` is **already installed** (`root:root 0755`,
2026-09-04). The installer verifies it rather than placing it, so re-copy it from
`scripts/brain-release.sh` after changing that file:

```
sudo cp scripts/brain-release.sh /opt/migrapilot/bin/brain-release.sh
sudo chown root:root /opt/migrapilot/bin/brain-release.sh
sudo chmod 0755 /opt/migrapilot/bin/brain-release.sh
```

Get a **runner registration token** from:

> GitHub → `Migrateck-Ecosystem/migra-ecosystem-platform` → Settings → Actions →
> Runners → **New self-hosted runner** → Linux x64

It is short-lived (~1 hour) and is not a PAT. The runner exchanges it for its own
credential and it is never needed again. Then, on VM111:

```
sudo ./scripts/install-brain-deploy-runner.sh --token <PASTE_TOKEN>
```

The script never echoes, logs or writes the token. Do not put it in a commit.

What it does, and why each part is shaped that way:

1. **Verifies `/opt/migrapilot/bin/brain-release.sh` is root-owned and not
   group/other writable — first, before anything else.** The whole privilege model
   rests on it: the runner may *invoke* that file, never *edit* it. If the runner
   could rewrite it, "one privileged command" would silently mean "any command".
2. **Creates `migradeploy`** — a system account with `/usr/sbin/nologin`. The runner
   does not need a login shell.
3. **Installs the runner under `/opt/migrapilot/actions-runner`** with the labels
   `self-hosted,vm111`, which is what `runs-on:` selects. A label mismatch makes jobs
   queue forever rather than fail, so check `./svc.sh status` if nothing runs.
4. **Grants exactly one privileged command** via `/etc/sudoers.d/migradeploy`:
   `migradeploy ALL=(root) NOPASSWD: /opt/migrapilot/bin/brain-release.sh *`.
   Not `ALL`, not `systemctl`, not a wildcard path.
5. **Installs and starts the systemd service.**

### The trust boundary, stated plainly

A self-hosted runner executes workflow code from the repository on a production
host. Anyone who can push a workflow change can run code as `migradeploy` on VM111.
That is inherent to continuous delivery, not a flaw in the setup — and it is exactly
why the runner is unprivileged and its one privileged capability is a root-owned
script it cannot modify.

## 4. Arm it

```bash
git branch deploy/brain <sha-that-passed-gap2-repro>
git push origin deploy/brain
```

From then on: **move `deploy/brain` to a commit you have decided to ship.** The gate
runs on that ref; when it goes green, the deploy fires on that exact sha.

Deliberately *not* "every green commit on the working branch" — several lanes land
there continuously, and on the day this was written an unrelated lane was mid-feature
on it. Auto-deploying whatever compiles would ship someone's half-built work.

To redeploy a known-good commit without moving the ref, use **Run workflow** on
`deploy-brain` and pass the sha.

## 5. Stopping a deploy

**From the box, no GitHub needed:**

```bash
echo "paused: <reason, who, when>" | sudo tee /etc/migrapilot/deploy.disabled
```

Every subsequent run fails at the first step with that reason. Delete the file to
resume.

**Rolling back** is a symlink swap and a restart — seconds, and `brain-release.sh`
already does it automatically when the post-activation health check fails:

```bash
sudo ln -sfn /opt/migrapilot/brain-service/releases/<previous> /opt/migrapilot/brain-service/current
sudo systemctl restart migrapilot-brain.service
```

Roll back **first**, diagnose after.

## What the pipeline guarantees

Pinned by `apps/brain-service/test/deployPipelineSafety.test.ts`, so removing one is
a failing test rather than a silent one-line edit:

- a **failed** gate can never deploy
- deploys come only from the explicit `deploy/brain` ref
- the commit deployed is the commit that was **tested** (`head_sha`, never a branch tip)
- two deploys cannot race, and one in flight is never cancelled
- the release goes through `brain-release.sh --activate`, which boot-tests on a spare
  port and rolls back automatically on an unhealthy activation
- the payload comes from `scripts/build-brain-payload.sh` — the same builder a human
  uses, so a hand deploy and a runner deploy produce the same tree
- every script the pipeline runs is **git-tracked**, not merely present on a disk
  (the root `.gitignore` is an allowlist; a new script is invisible until named there,
  and that has already cost one release)
- the brain suite re-runs **on VM111**, not only on a hosted runner
- an unhealthy service after activation fails the deploy loudly

## What it does not cover

Only the **Brain**. The consumer (`chat.migrateck.com`) still deploys by hand — one
service per release, so a failure says which half broke. `scripts/consumer-release.sh`
exists; wiring it the same way is the obvious next step once this has run for a while.
