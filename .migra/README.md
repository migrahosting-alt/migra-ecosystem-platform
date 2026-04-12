# Migra Infra Artifacts

This directory is generated/maintained by MigraAgent.

## Files
- infra.snapshot.json — machine-readable infra source of truth
- infra.snapshot.md — human-readable infra overview
- scan.report.md — scan findings and warnings
- runbooks/ — operational runbooks

## Rules
- Scan-first: do not apply changes until scan results are reviewed.
- Always include validation + rollback steps for operational changes.
- Do not store secrets in this directory.
