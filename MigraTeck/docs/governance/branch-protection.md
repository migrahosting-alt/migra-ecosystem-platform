# Branch Protection Guidance

Apply these rules to the primary delivery branch for the MigraTeck platform workspace:

1. Require pull requests before merging.
2. Require at least 2 approving reviews.
3. Dismiss stale approvals when new commits are pushed.
4. Require the `MigraTeck Platform CI / validate` check to pass.
5. Require the `MigraTeck Platform CI / secret-scan` check to pass.
6. Require branches to be up to date before merging.
7. Restrict force pushes and branch deletion.

This document is the operational source of truth until the repository-level branch protection settings are applied remotely.
