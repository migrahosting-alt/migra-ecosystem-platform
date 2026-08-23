# MigraPilot — Production Runbook

> 3-Brain LLM Architecture: Local vLLM → Claude Sonnet → Claude Opus

---

## 1. Architecture Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  🟢 vLLM     │────▶│  🟡 Sonnet   │────▶│  🔴 Opus     │
│  (default)   │  ↑  │  (escalation)│  ↑  │  (final)     │
│  FREE local  │  │  │  $0.003/1K   │  │  │  $0.015/1K   │
└──────────────┘  │  └──────────────┘  │  └──────────────┘
                  │                    │
           local fails /         sonnet fails /
           context > 12K tokens  high-stakes task
```

The router always prefers the cheapest provider that can handle the request.
Escalation is automatic based on: context size, tool failures, security review needs, or provider errors.

## 2. Environment Variables

All config lives in `services/pilot-api/.env`. Reference: `.env.example`

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_LLM_BASE_URL` | `http://localhost:8000/v1` | vLLM OpenAI-compat endpoint |
| `LOCAL_LLM_MODEL` | `NousResearch/Meta-Llama-3-8B-Instruct` | Model served by vLLM |
| `LOCAL_LLM_API_KEY` | `local-token` | vLLM auth token |
| `ANTHROPIC_API_KEY` | — | Claude API key (required for cloud escalation) |
| `ANTHROPIC_SONNET_MODEL` | `claude-3-5-sonnet-latest` | Sonnet model ID |
| `ANTHROPIC_OPUS_MODEL` | `claude-3-opus-latest` | Opus model ID |
| `LOCAL_BACKOFF_SECONDS` | `60` | Backoff duration after local failure |
| `MAX_OPUS_CALLS_PER_RUN` | `1` | Hard cap on Opus calls per agent run |
| `MAX_SONNET_CALLS_PER_RUN` | `3` | Hard cap on Sonnet calls per agent run |
| `MAX_TOTAL_TOKENS_PER_RUN` | `60000` | Token budget per agent run |
| `CONTEXT_ESCALATION_TOKENS` | `12000` | Escalate to Sonnet when context exceeds this |
| `MAX_CONTEXT_MESSAGES` | `12` | Max message history sent to LLM |

## 3. Starting vLLM

```bash
# GPU server — start vLLM with OpenAI-compat API
python -m vllm.entrypoints.openai.api_server \
  --model NousResearch/Meta-Llama-3-8B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --api-key local-token \
  --max-model-len 8192 \
  --dtype auto \
  --enforce-eager

# Verify
curl http://localhost:8000/v1/models -H "Authorization: Bearer local-token"
```

### Production flags for vLLM
- `--max-model-len 8192` — prevents OOM on smaller GPUs
- `--dtype auto` — auto-selects bf16/fp16 based on GPU
- `--enforce-eager` — disables CUDA graph (saves memory, slight latency cost)
- `--gpu-memory-utilization 0.9` — use 90% of GPU VRAM
- `--tensor-parallel-size N` — multi-GPU parallelism

## 4. Rotating the Anthropic API Key

```bash
# 1. Generate a new key at https://console.anthropic.com
# 2. Update the env file
ssh root@<pilot-api-host>
cd /opt/mpanel  # or wherever pilot-api is deployed
nano .env       # Update ANTHROPIC_API_KEY=sk-ant-...

# 3. Restart API (zero-downtime — local LLM keeps serving)
pm2 restart mpanel-api --update-env
pm2 status
```

The old key continues working until Anthropic revokes it. Local vLLM is unaffected during rotation.

## 5. Adjusting Escalation Thresholds

Edit `.env` and restart:

```bash
# Make Sonnet trigger sooner (e.g., 8K tokens instead of 12K)
CONTEXT_ESCALATION_TOKENS=8000

# Allow more Sonnet calls before trying Opus
MAX_SONNET_CALLS_PER_RUN=5

# Disable Opus entirely (set cap to 0)
MAX_OPUS_CALLS_PER_RUN=0

# Increase per-run token budget
MAX_TOTAL_TOKENS_PER_RUN=100000

pm2 restart mpanel-api --update-env
```

## 6. Disabling Opus Temporarily

Set `MAX_OPUS_CALLS_PER_RUN=0` in `.env` and restart. All requests that would escalate to Opus will stay on Sonnet. If Sonnet also fails, the agent will return an error asking the user to try again.

## 7. Disabling Cloud Providers Entirely

Remove or blank `ANTHROPIC_API_KEY` in `.env` and restart. The router will only use the local vLLM. If local fails, the agent returns an error. Useful for air-gapped deployments.

## 8. Inspecting Audit Logs

```sql
-- Recent runs with token usage
SELECT id, model, status, "inputTokens", "outputTokens", "totalTokens",
       "escalationReason", "startedAt", "endedAt"
FROM "PilotRun"
ORDER BY "startedAt" DESC
LIMIT 20;

-- Tool call audit trail
SELECT al."action", al."resource", al."actorId", al."createdAt",
       al."afterJson"->>'toolCallId' as tool_call_id
FROM "AuditLog" al
WHERE al."action" LIKE 'tool.%'
ORDER BY al."createdAt" DESC
LIMIT 50;

-- Cost by provider (last 7 days)
SELECT
  split_part(model, ':', 1) as provider,
  COUNT(*) as runs,
  SUM("inputTokens") as total_input,
  SUM("outputTokens") as total_output,
  SUM("totalTokens") as total_tokens
FROM "PilotRun"
WHERE "startedAt" > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY total_tokens DESC;
```

## 9. Admin Dashboard

Navigate to: `http://localhost:3399/pilot/admin`

Shows:
- **Summary cards**: Total runs, total tokens, estimated cost
- **Provider breakdown**: Per-provider token counts, costs, run counts, failures
- **Recent runs**: Provider badge (🟢🟡🔴), token counts, escalation reasons, tool call stats

## 10. Monitoring & Alerts

### Health checks
```bash
# Local vLLM
curl -s http://localhost:8000/v1/models | jq '.data[0].id'

# Pilot API
curl -s http://localhost:3377/api/health | jq .

# Database
psql -h 127.0.0.1 -p 5433 -U migra migra_core -c "SELECT COUNT(*) FROM \"PilotRun\";"
```

### Key metrics to watch
- **Local failure rate**: If local fails frequently, check vLLM GPU memory / model loading
- **Escalation frequency**: High escalation = context too long or local model too weak
- **Cost per day**: Monitor Sonnet + Opus costs via admin dashboard
- **Token budget hits**: `PRECONDITION_FAILED` errors indicate runs hitting the cap

### Log locations
```bash
# Pilot API (pm2)
pm2 logs mpanel-api --lines 100

# Look for escalation decisions
pm2 logs mpanel-api | grep "\[llm-router\]"

# Look for local backoff
pm2 logs mpanel-api | grep "markLocalUnavailable"
```

## 11. Secret Redaction

The Claude provider automatically redacts these fields before sending to Anthropic's cloud:
- `secret`, `password`, `token`, `apiKey`, `api_key`
- `authorization`, `approvalToken`, `idempotencyKey`, `credentials`

This is enforced in `claudeProvider.ts` via `redactMessages()` — called before every cloud API call.

## 12. Cost Safety

| Guard | Mechanism |
|-------|-----------|
| Token budget per run | `MAX_TOTAL_TOKENS_PER_RUN` → agent aborts with `PRECONDITION_FAILED` |
| Opus call cap | `MAX_OPUS_CALLS_PER_RUN` → falls back to Sonnet if exceeded |
| Sonnet call cap | `MAX_SONNET_CALLS_PER_RUN` → won't escalate further |
| Local backoff | `LOCAL_BACKOFF_SECONDS` → avoids hammering failed local server |
| Context trimming | `MAX_CONTEXT_MESSAGES` → rolling window, old messages dropped |

## 13. Troubleshooting

| Problem | Solution |
|---------|----------|
| All requests go to Sonnet | vLLM is down or backoff active. Check: `curl localhost:8000/v1/models` |
| "Token budget exceeded" | Increase `MAX_TOTAL_TOKENS_PER_RUN` or simplify the task |
| "PRECONDITION_FAILED" in chat | Same as above — token cap hit |
| Opus never triggers | `MAX_OPUS_CALLS_PER_RUN=0` or no high-risk/security tasks detected |
| "LLM provider error after escalation" | All 3 providers failed. Check network, API keys, vLLM status |
| Admin page shows $0 cost | Only local runs — no cloud bills |
| High latency | Local model loading, or Anthropic API slow. Check `[llm-router]` logs |

## 14. Acceptance Test Flow

```bash
# 1. Start vLLM (must be running)
# 2. Start pilot-api
cd services/pilot-api && npm start

# 3. Start pilot-web
cd apps/pilot-web && npm run dev

# 4. Open chat: http://localhost:3399/pilot
# 5. Send a simple message → should see 🟢 Local badge
# 6. Send: "Analyze the security posture of our NGINX config"
#    → should escalate to 🟡 Sonnet (security keyword detected)
# 7. Check admin: http://localhost:3399/pilot/admin
#    → verify token counts, cost, escalation reasons
# 8. Stop vLLM, send a message → should auto-escalate to Sonnet
# 9. Restart vLLM, wait 60s, send again → back to 🟢 Local
```

---

## 15. Policy-as-Code Engine

MigraPilot includes a declarative OPA-style policy engine that evaluates every tool call against a set of rules.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pilot/policy/rules` | GET | List all active policy rules |
| `/api/pilot/policy/timeline/:conversationId` | GET | Get policy decisions for a conversation |
| `/api/pilot/policy/evaluate` | POST | Evaluate a tool call against policy rules |

### Built-in Rules

| Rule ID | Verdict | Description |
|---------|---------|-------------|
| `deny-unknown-tool` | deny | Blocks tools not in the registry |
| `deny-internal-domain` | deny | Blocks args containing internal domains |
| `deny-internal-path` | deny | Blocks args with `/etc/`, `/root/`, `/proc/` paths |
| `deny-internal-bucket` | deny | Blocks S3 bucket names containing `internal` |
| `deny-cross-tenant` | deny | Blocks cross-tenant resource access |
| `deny-missing-tenant` | deny | Blocks tool calls without tenantId |
| `approve-danger-tools` | approve | DANGER-tier tools require human approval |
| `approve-write-no-preflight` | approve | Write tools without prior read require approval |
| `approve-high-spend` | approve | Spending > $50 requires approval |
| `allow-read-tools` | allow | Read/list tools pass automatically |
| `allow-write-with-preflight` | allow | Writes pass if a read was done first |

### Viewing Policy Decisions in the UI

Click the **🛡️ Policy** button in the top bar to open the Policy Timeline panel. It shows:
- Verdict badges (ALLOW / DENY / APPROVE) with color coding
- Rule ID that matched
- Reason description
- Tool name and timestamp
- Summary counts per verdict type

### Adding Custom Rules

```typescript
import { addPolicyRule } from "./services/policyAsCode.js";

addPolicyRule({
  id: "deny-prod-writes",
  description: "Block writes to production servers during business hours",
  priority: 100,
  evaluate: (ctx) => {
    const isProd = ctx.args?.server?.includes("prod");
    const hour = new Date().getHours();
    if (isProd && hour >= 9 && hour <= 17) return "deny";
    return null; // no opinion — next rule decides
  },
});
```

---

## 16. Memory Service & Engineering State

MigraPilot maintains persistent engineering state across conversations — tracking architecture decisions, implemented features, TODOs, and risks.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pilot/memory/state` | GET | Get current engineering state |
| `/api/pilot/memory/state` | POST | Update engineering state (JSON merge patch) |
| `/api/pilot/memory/summary/:conversationId` | GET | Get latest conversation summary |
| `/api/pilot/memory/recent/:conversationId` | GET | Get recent memory entries |

### State Shape

```json
{
  "architecture": ["Express API on port 3377", "Next.js 15 on port 3399"],
  "implemented": ["3-brain routing", "Tool approval system", "Admin dashboard"],
  "todos": ["Add OpenTelemetry traces", "pgvector embeddings"],
  "risks": ["vLLM single-point-of-failure without GPU redundancy"],
  "notes": ["Session 4 added policy-as-code and memory service"]
}
```

### UI Integration

Click the **🧠 State** button in the top bar to open the Engineering State panel. Shows:
- Architecture items in blue
- Implemented items in green
- TODOs in yellow
- Risks in red
- Notes in gray
- Auto-refreshes when memory_update events arrive via SSE

### Automatic Summarization

After every 5 message exchanges, MigraPilot automatically generates a conversation summary and stores it. The Memory Agent can also push state updates based on decisions made during a run.

---

## 17. Two-Pass Orchestrator Protocol

MigraPilot uses a multi-agent orchestrator with a two-pass review protocol:

### Phase Flow

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Planner  │───▶│ Code     │───▶│ Tool     │───▶│ Reviewer  │───▶│ Memory   │
│ (Sonnet) │    │ (Sonnet) │    │ (Sonnet) │    │ (Opus)    │    │ (Local)  │
│ Plan     │    │ Patches  │    │ Execute  │    │ Review    │    │ State    │
└─────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

1. **Planner** — Sonnet analyzes the request, determines phases
2. **Code Agent** — Generates code patches (NEVER calls tools)
3. **Tool Agent** — Executes tool calls (NEVER generates code)
4. **Reviewer** — Opus-only pass that reviews everything (NEVER calls tools or generates code)
5. **Summarizer** — Produces final human-friendly summary
6. **Memory Agent** — Updates engineering state

### 7 Agent Roles

| Role | Provider | Can Call Tools | Can Generate Code |
|------|----------|---------------|-------------------|
| planner | Sonnet | No | No |
| code | Sonnet | No | Yes |
| tool | Sonnet | Yes | No |
| reviewer | Opus | No | No |
| summarizer | Local | No | No |
| incident | Sonnet | Yes | No |
| memory | Local | No | No |

---

## 18. Eval Harness

See [EVALS.md](EVALS.md) for full documentation. Quick start:

```bash
# Run all 25 tests across 8 categories
cd services/pilot-api
npx tsx src/eval/run.ts

# Run specific category
npx tsx src/eval/run.ts --filter=policy
npx tsx src/eval/run.ts --filter=golden
```

---

## 19. New API Routes Summary

| Route | Description | Added |
|-------|-------------|-------|
| `GET /api/pilot/policy/rules` | List policy rules | Session 4 |
| `GET /api/pilot/policy/timeline/:id` | Policy decision timeline | Session 4 |
| `POST /api/pilot/policy/evaluate` | Evaluate tool call against policies | Session 4 |
| `GET /api/pilot/memory/state` | Engineering state | Session 4 |
| `POST /api/pilot/memory/state` | Update engineering state | Session 4 |
| `GET /api/pilot/memory/summary/:id` | Latest conversation summary | Session 4 |
| `GET /api/pilot/memory/recent/:id` | Recent memory entries | Session 4 |

---

## 20. Full Tool Registry (35 tools)

### Infrastructure (17 tools)
`system.health`, `pods.list`, `pods.create`, `pods.delete`, `dns.lookup`, `dns.list`, `nginx.reload`, `firewall.list`, `certificates.renew`, `backup.status`, `monitoring.alerts`, `logs.search`, `audit.recent`, `billing.usage`, `network.test`, `domains.list`, `domains.create`

### Repository (9 tools)
`repo.listFiles`, `repo.readFile`, `repo.search`, `repo.gitStatus`, `repo.gitLog`, `repo.gitDiff`, `repo.lint`, `repo.test`, `repo.updateFile`

### Knowledge (5 tools)
`knowledge.search`, `knowledge.getDocument`, `knowledge.addDocument`, `knowledge.similar`, `knowledge.listTags`

### Memory (2 tools)
`memory.getEngineeringState`, `memory.updateEngineeringState`

### Patches (1 tool)
`repo.getPatch`
