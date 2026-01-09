# mPanel Ops Runbook

- Check PM2: `ssh mpanel-core '/usr/local/bin/pm2 status'`
- Tail logs (if needed): `ssh mpanel-core '/usr/local/bin/pm2 logs --lines 200'`
- No restarts without explicit approval.
