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

## 1. Register the runner  *(you — it needs a token)*

Get a **runner registration token** from:

> GitHub → `Migrateck-Ecosystem/migra-ecosystem-platform` → Settings → Actions →
> Runners → **New self-hosted runner** → Linux x64

It is short-lived (about an hour) and is not a PAT. Do not paste it into chat, a
commit, or a file — pass it to `config.sh` and let the runner store its own
credential.

On VM111, as a **dedicated unprivileged user** (not root, not `bonex`):

```bash
sudo useradd -m -s /bin/bash migradeploy
sudo -u migradeploy -H bash -lc '
  mkdir -p ~/actions-runner && cd ~/actions-runner
  curl -sSLo r.tar.gz https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-linux-x64-2.319.1.tar.gz
  tar xzf r.tar.gz && rm r.tar.gz
  ./config.sh --unattended \
    --url https://github.com/Migrateck-Ecosystem/migra-ecosystem-platform \
    --labels self-hosted,vm111 \
    --name vm111 \
    --token <PASTE_TOKEN_HERE>
'
cd /home/migradeploy/actions-runner && sudo ./svc.sh install migradeploy && sudo ./svc.sh start
```

The label **`vm111`** is what `runs-on: [self-hosted, vm111]` selects. If it does not
match, jobs queue forever rather than failing — check `./svc.sh status`.

## 2. Install the release script where the pipeline expects it — ✅ ALREADY DONE

The workflow calls `/opt/migrapilot/bin/brain-release.sh`. It is installed from the
repo copy, `root:root 0755`, verified 2026-09-04. Re-run these after changing the
script, so the deployed copy stays the reviewed one:

```bash
sudo mkdir -p /opt/migrapilot/bin
sudo cp scripts/brain-release.sh /opt/migrapilot/bin/brain-release.sh
sudo chown root:root /opt/migrapilot/bin/brain-release.sh
sudo chmod 0755 /opt/migrapilot/bin/brain-release.sh
```

Root-owned and not writable by the runner user **on purpose**: the runner is allowed
to *invoke* it, never to *edit* it. Otherwise "run one privileged command" becomes
"run any command", because the runner could rewrite the script first.

## 3. Grant exactly one privileged command  *(you — it is a security change)*

```bash
sudo visudo -f /etc/sudoers.d/migradeploy
```

```
migradeploy ALL=(root) NOPASSWD: /opt/migrapilot/bin/brain-release.sh --payload * --name * --activate
```

Then `sudo chmod 0440 /etc/sudoers.d/migradeploy`.

That is the whole grant: one script, one argument shape. Not `ALL`, not `systemctl`,
not a wildcard path.

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
