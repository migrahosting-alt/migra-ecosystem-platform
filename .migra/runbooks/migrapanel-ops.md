# MigraPanel Panel API Ops Runbook

- Check service state: `ssh migrapanel-core 'systemctl status migrapanel-panel-api.service --no-pager'`
- Tail logs (if needed): `ssh migrapanel-core 'journalctl -u migrapanel-panel-api.service --lines 200 --no-pager'`
- No restarts without explicit approval.
- Files/storage migration path: `.migra/runbooks/migrapanel-migradrive-files.md`
