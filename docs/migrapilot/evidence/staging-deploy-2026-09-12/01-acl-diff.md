# Tailnet ACL — the exact diff, recorded before applying

Captured from `console.tailscale.com/admin/acls/file` at 2026-09-12T17:11Z, **before** any edit.

## Policy as it stands now

```jsonc
{
	"tagOwners": {
		"tag:server":         ["autogroup:admin"],
		"tag:personal":       ["autogroup:admin"],
		"tag:annoupale-core": ["autogroup:admin"],
		"tag:pale-core":      ["autogroup:admin"],
		"tag:migracms-core":  ["autogroup:admin"],
	},

	"acls": [
		{
			"action": "accept",
			"src":    ["*"],
			"dst":    ["*:*"],
		},
	],

	"ssh": [
		{
			"action": "accept",
			"src":    ["autogroup:admin", "tag:server"],
			"dst":    ["tag:server"],
			"users":  ["root", "autogroup:nonroot"],
		},
		{
			"action": "accept",
			"src":    ["autogroup:member"],
			"dst":    ["tag:server"],
			"users":  ["root"],
		},
	],
	"nodeAttrs": [
		{
			"target": ["autogroup:member"],
			"attr":   ["funnel"],
		},
	],
}
```

## 🚨 What this reading changes about the plan — nothing, and here is why that matters

Two SSH rules already exist, both granting `root` to **`tag:server`**. The tempting shortcut is
to tag the staging node `tag:server` and add no rule at all — zero diff.

**Rejected.** `tag:server` is carried by the existing infrastructure fleet (`db-core`,
`app-core`, `nginx-proxy-core`, and the rest that report as `tagged-devices`). Reusing it would
mean the staging node inherits whatever that tag is granted forever after, and that any future
widening of the `tag:server` rules silently widens staging too. A dedicated tag is one extra
line and keeps the blast radius at one node.

The second existing rule grants `autogroup:member` → `tag:server`. It is pre-existing and is
**not** touched.

## The diff to be applied

```diff
 	"tagOwners": {
 		"tag:server":         ["autogroup:admin"],
 		"tag:personal":       ["autogroup:admin"],
 		"tag:annoupale-core": ["autogroup:admin"],
 		"tag:pale-core":      ["autogroup:admin"],
 		"tag:migracms-core":  ["autogroup:admin"],
+		"tag:migrapilot-staging": ["autogroup:admin"],
 	},
@@
 	"ssh": [
 		{
 			"action": "accept",
 			"src":    ["autogroup:admin", "tag:server"],
 			"dst":    ["tag:server"],
 			"users":  ["root", "autogroup:nonroot"],
 		},
 		{
 			"action": "accept",
 			"src":    ["autogroup:member"],
 			"dst":    ["tag:server"],
 			"users":  ["root"],
 		},
+		{
+			// MigraPilot STAGING ONLY — CT101 / migrapilot-staging-core.
+			// Its own tag, not tag:server, so widening the fleet rules can
+			// never widen this one. Production (migrapilot-app-core) is
+			// user-owned and carries no tag, so it is unreachable by this rule.
+			"action": "accept",
+			"src":    ["autogroup:admin"],
+			"dst":    ["tag:migrapilot-staging"],
+			"users":  ["root"],
+		},
 	],
```

**Two lines of substance: one tag owner, one SSH rule.**

## Checked against every constraint given

| constraint | how this satisfies it |
| --- | --- |
| target only `migrapilot-staging-core` | a brand-new tag that only that node will carry |
| only the intended operator identity | `src: ["autogroup:admin"]` — narrower than the `autogroup:member` rule already present |
| only the required SSH users | `users: ["root"]` only — **no** `autogroup:nonroot`, unlike the existing `tag:server` rule |
| must not use `autogroup:self` | not used; it would have matched production, which is owned by the same user |
| must not grant access to production nodes | `migrapilot-app-core` is user-owned and untagged — no rule here can reach it |
| must not broaden general tailnet access | the `acls` block, `nodeAttrs`, and both existing ssh rules are byte-identical |

## Material-difference check against the reviewed `STAGING_SSH_ACL.md`

| reviewed | applying | same? |
| --- | --- | --- |
| `tagOwners: {"tag:migrapilot-staging": ["autogroup:admin"]}` | identical | ✅ |
| `ssh: src ["autogroup:admin"］, dst ["tag:migrapilot-staging"], users ["root"], action accept` | identical | ✅ |

**No material difference. Proceeding.**

## The node-side command this requires

```sh
tailscale up --hostname=migrapilot-staging-core \
             --accept-dns=false --accept-routes=false --ssh \
             --advertise-tags=tag:migrapilot-staging --force-reauth
```

Ownership moves from `migrahosting@` to the tag. That is the intended outcome — staging is
infrastructure — and it is what makes the rule above targetable at all.
