# The one rule that lets the deploy tooling reach staging

**Status: PREPARED, NOT APPLIED.** This is a tailnet security-policy change and it is
the owner's to make. Nothing in this file has been applied.

## What is already true

| | |
| --- | --- |
| Node | `migrapilot-staging-core` · `100.83.46.93` · owner `migrahosting@` |
| MagicDNS | resolves from the workstation — `DEPLOY_HOST=migrapilot-staging-core` needs **no** change to `deploy-targets.sh` |
| Tailscale SSH | **enabled on the node** (`tailscale up --ssh`) |
| What happens today | `ssh root@migrapilot-staging-core` → *"tailnet policy does not permit you to SSH to this node"* |

The connection reaches the node. Only the ACL refuses it.

## Why not the obvious rule

The tempting one-liner is `dst: ["autogroup:self"]` — every device you own. **Do not use it.**
`migrapilot-app-core` (VM111, production) is also owned by `migrahosting@`, so that rule
would hand Tailscale SSH to production in the same stroke. The whole point of a staging
target is that it cannot be confused with production.

So the destination has to be a **tag**, which means tagging the node first.

## Step 1 — allow the tag to exist (tailnet policy file)

```json
"tagOwners": {
  "tag:migrapilot-staging": ["autogroup:admin"]
}
```

## Step 2 — the SSH rule, as narrow as it goes

```json
"ssh": [
  {
    "action": "accept",
    "src":    ["autogroup:admin"],
    "dst":    ["tag:migrapilot-staging"],
    "users":  ["root"]
  }
]
```

`action: "accept"` rather than `"check"` because the deploy scripts are non-interactive —
`check` would prompt for re-authentication mid-deploy and hang. If you would rather have the
prompt for hand-run sessions, add a second `check` rule for a different `src` and keep this
one for the deploy path.

## Step 3 — put the tag on the node

Run **on CT101** (via `ssh pve` → `pct exec 101`). It forces re-authentication, so the node
drops off the tailnet for a few seconds:

```sh
tailscale up --hostname=migrapilot-staging-core \
             --accept-dns=false --accept-routes=false --ssh \
             --advertise-tags=tag:migrapilot-staging --force-reauth
```

🚨 A tagged node becomes owned by the TAG, not by `migrahosting@`. That is the intended
outcome — staging is infrastructure, not someone's laptop — but it also means it stops
appearing under your personal devices.

## Step 4 — prove it before trusting it

```sh
ssh root@migrapilot-staging-core 'hostname; systemctl is-active migrapilot-staging-brain'
```

Expect `migrapilot-core` and `active`. Until that line works, staging is deployed by hand.

## What still has to be true on the host afterwards

The deploy scripts run privileged commands on the target, so the account they land on needs:

- non-interactive elevation for `systemctl`, `systemd-run`, `ln -sfn`, `mkdir`, `cp -al`, and a
  recursive delete of the release directory being restaged
- `curl`, `journalctl`, `readlink`, `tar` — all present on CT101
- the `sudo` package itself — **CT101 does not have it installed**. Root over Tailscale SSH does
  not need elevation, but the scripts invoke the command literally, so install it:
  `apt-get install -y sudo`

## And then the first real deploy

```sh
docs/migrapilot/deploy-brain.sh    --target staging <release-name>
docs/migrapilot/deploy-consumer.sh --target staging <release-name>
```

Both refuse a first deploy by design — they validate a servable `$ROOT/current` before
anything moves. The hand-built bootstrap already satisfies that, so the first scripted deploy
has a rollback target waiting.

🚨 `deploy-consumer.sh` had the production unit name hard-coded in its cutover restart **and
in the rollback command it prints**; fixed in `50e2bcec`. Had it run against staging before
that, the rollback an operator copies at the worst moment would have restarted nothing.

## To undo all of this

Remove the two policy blocks, then on CT101 re-run `tailscale up` without `--ssh` and without
`--advertise-tags` (adding `--force-reauth`), or `tailscale logout` to leave the tailnet
entirely.
