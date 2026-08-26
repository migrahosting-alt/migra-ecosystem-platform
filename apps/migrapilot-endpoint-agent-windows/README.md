# MigraPilot Endpoint Agent (Windows MVP)

This agent is the first real endpoint collector for MigraGuard HIDS/EDR orchestration.

## Capabilities in this slice

- Device identity bootstrap with persisted `agent_id` and local key material
- Enrollment to `POST /api/autonomy/hids-edr/enroll`
- Event collection
  - Windows: `wevtutil` pull from Security and Sysmon channels
  - Non-Windows: fixture events for local validation
- Local JSONL buffering for offline durability
- Authenticated event ingest to `POST /api/autonomy/hids-edr`
- Heartbeat to `POST /api/autonomy/hids-edr/heartbeat`
- Nonce + timestamp usage for replay protection compatibility

## Run

Set env vars:

- `MIGRAPILOT_BASE_URL` (example: `http://127.0.0.1:3401`)
- `MIGRAPILOT_AGENT_NAME`
- `MIGRAPILOT_AGENT_HOST`
- `MIGRAPILOT_AGENT_OS` (default `windows`)
- `MIGRAPILOT_AGENT_DATA_DIR` (default `./data`)
- `MIGRAPILOT_ENROLL_KEY` (if enrollment key is required by server)

Then run:

```bash
go run ./cmd/agent
```

## Notes

- Code signing is not implemented in-repo because certificate issuance and private key storage are external PKI operations.
- Safe response execution on endpoints remains approval-gated server-side in this slice (no destructive auto-action path in the agent).
