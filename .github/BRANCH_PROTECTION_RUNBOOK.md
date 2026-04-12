# Branch Protection Runbook (Enterprise)

This runbook enforces deploy-blocking quality controls for MigraPilot.

Primary gate workflow:

- `.github/workflows/migrapilot-enterprise-gate.yml`
- Required check name: **Chat Quality Gate (Deep Strict)**

Workspace hygiene gate:

- `.github/workflows/workspace-hygiene-gate.yml`
- Required check name: **Workspace Hygiene (Strict)**

## Objective

Prevent merges to `main` unless enterprise chat quality gates pass:

- Deep strict SLO gates
- Deep regression comparison
- Artifact generation for audit trail
- Workspace hygiene policy enforcement for root clutter and `docs/reports` bucketing

## GitHub UI Configuration

1. Open repository **Settings**.
2. Go to **Branches**.
3. Under **Branch protection rules**, click **Add rule**.
4. Branch name pattern: `main`.
5. Enable:
   - **Require a pull request before merging**
   - **Require status checks to pass before merging**
   - **Require branches to be up to date before merging**
6. In required status checks, select:
   - **Chat Quality Gate (Deep Strict)**
   - **Workspace Hygiene (Strict)**
7. Enable recommended enterprise controls:
   - **Require conversation resolution before merging**
   - **Do not allow bypassing the above settings**
   - **Restrict who can push to matching branches**
8. Save changes.

## Policy Baseline

The workflow already pins deterministic thresholds via env:

- `SLO_DEEP_MIN_RELIABILITY=1`
- `SLO_DEEP_MAX_P95_MS=30000`
- `SLO_DEEP_MAX_ARTIFACT_LEAK_RATE=0`
- `SLO_DEEP_MAX_EMPTY_REPLY_RATE=0.25`
- `SLO_DEEP_MIN_OVERALL=0.78`
- `SPEED_DEEP_P95_BUDGET_MS=30000`
- `REG_MAX_P95_INCREASE_MS=2500`
- `REG_MAX_OVERALL_DROP=0.05`
- `REG_MAX_RELIABILITY_DROP=0`

## Secret Requirement

Set repository secret:

- `CLAUDE_API_KEY`

Without this secret, the gate intentionally fails.

## Optional GitHub CLI Setup

If you prefer CLI-managed policy, use:

```bash
gh api repos/<owner>/<repo>/branches/main/protection \
  --method PUT \
   --input .github/branch-protection.main.json
```

The repository now includes a ready-to-use payload at `.github/branch-protection.main.json`.
It requires both `Chat Quality Gate (Deep Strict)` and `Workspace Hygiene (Strict)`.

A helper script is also available:

```bash
bash scripts/apply-branch-protection.sh
```

That command runs in preview mode, infers the GitHub `origin` repo when possible, shows auth status, and prints the exact `gh api` command that would be used.
Use `--apply` only when you intend to update the live branch protection settings.

VS Code tasks are available for the same flow:

- `GitHub Auth Status`
- `Preview Branch Protection (gh)`
- `Apply Branch Protection (gh)`

`GitHub Auth Status` is informational: if you are not logged in yet, it prints the next command to run instead of treating that state as a task failure.
That task runs `scripts/check-gh-auth.sh` under the hood.

If you want to apply it from the workspace root, run:

```bash
gh auth status
gh api repos/<owner>/<repo>/branches/main/protection \
   --method PUT \
   --input .github/branch-protection.main.json
```

## Verification Checklist

After configuration:

1. Open a PR touching `services/pilot-api/**`.
2. Confirm workflow run appears: **MigraPilot Enterprise Gate**.
3. Confirm required check appears in PR merge box:
   - **Chat Quality Gate (Deep Strict)**
   - **Workspace Hygiene (Strict)**
4. Verify merge is blocked while check is pending or failing.
5. Verify merge is allowed only after passing check.

## Operations Notes

- If deep compare has no historical baseline, bootstrap-safe mode allows first pass.
- If quality regresses, merge remains blocked until fixed or thresholds are intentionally updated through review.
- If workspace hygiene fails, run `bash scripts/audit-workspace-root.sh --strict` locally or use the VS Code task `Audit Workspace Hygiene (strict)` to reproduce the violation set.
