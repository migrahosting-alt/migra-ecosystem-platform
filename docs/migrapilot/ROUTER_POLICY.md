# MigraPilot Router & Policy Engine

> How MigraPilot decides which LLM provider to use for each request.

## Overview

MigraPilot has a two-layer routing system:

1. **Policy Engine** (`policyEngine.ts`) — Advisory scoring that recommends a provider
2. **Router** (`router.ts`) — Final decision with cost caps and fallback logic

## Intent Classification

`classifyIntent(message)` categorizes every user message:

| Category | Trigger Keywords | Policy Score Bonus |
|----------|-----------------|-------------------|
| `security` | security, vulnerability, CVE, OWASP, firewall, SSL | +4 |
| `architecture` | architecture, redesign, refactor, schema change, migration | +3 |
| `debugging` | debug, trace, stack trace, error, crash, memory leak | +2 |
| `operator` | deploy, provision, create pod, DNS, mail, backup, scale | +0 |
| `engineering` | implement, code, function, class, test, build, PR | +1 |
| `chat` | (default) | +0 |

## Policy Scoring Matrix

The policy engine computes a score from multiple signals:

| Signal | Condition | Score |
|--------|-----------|-------|
| **Context size** | > `CONTEXT_ESCALATION_TOKENS` | +3 |
| **Context size** | > 70% of threshold | +1 |
| **Tool arg errors** | Each invalid arg count | +2 per |
| **Tool call failures** | Each failure | +3 per |
| **Task category** | security=4, architecture=3, debugging=2, engineering=1 | varies |
| **Risk level** | high=+5, medium=+2 | varies |
| **Sonnet failed** | Previous Sonnet error | +6 |

### Score → Provider Mapping

| Score | Provider | Reason |
|-------|----------|--------|
| ≥ 8 | **Opus** | High-stakes — needs best model |
| 3–7 | **Sonnet** | Moderate complexity |
| 0–2 | **Local** | Simple — use free model |

## Daily Budget Controls

| Setting | Default | Behavior |
|---------|---------|----------|
| `DAILY_SPEND_LIMIT_SOFT` | $1.00 | Log warning, continue normally |
| `DAILY_SPEND_LIMIT_HARD` | $5.00 | Force local-only for rest of day |

Daily spend tracked in-memory, resets at midnight UTC (or server restart).

Cost rates used:
- Local: $0/$0 per 1K tokens
- Sonnet: $0.003/$0.015 per 1K tokens (input/output)
- Opus: $0.015/$0.075 per 1K tokens

## Router Decision Flow

```
decide(hints):
  1. forceProvider?        → use forced provider
  2. Want Opus?            → high-risk OR security-review OR sonnet-failed
     └─ Opus capped?      → fall back to Sonnet
  3. Want Sonnet?          → architecture-review OR local-down OR big-context
                              OR invalid-args≥N OR failures≥N
     └─ Sonnet capped?    → fall back to Local
  4. Policy advisory?      → if policy says sonnet/opus and not capped → escalate
  5. Default               → Local
```

## Per-Run Cost Caps

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_SONNET_CALLS_PER_RUN` | 3 | Max Sonnet iterations in one agent loop |
| `MAX_OPUS_CALLS_PER_RUN` | 1 | Max Opus iterations in one agent loop |
| `MAX_TOTAL_TOKENS_PER_RUN` | 60,000 | Abort run if exceeded |

## Two-Pass Mode

For high-stakes tasks (security + high risk, or architecture + high risk):

```
twoPassRequired = category ∈ TWO_PASS_CATEGORIES AND
                  (riskLevel=high OR securityReview OR architectureReview)
```

Two-pass categories (configurable via `TWO_PASS_CATEGORIES` env):
- `security`
- `architecture`

When `twoPassRequired=true`:
1. Planner uses Sonnet to generate a plan
2. Reviewer uses Opus to assess safety/blast radius
3. Only approved steps proceed to Tool agent

## Configuration Reference

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `LOCAL_OPENAI_BASE_URL` | `http://localhost:8000/v1` | vLLM endpoint |
| `LOCAL_MODEL` | `NousResearch/Meta-Llama-3-8B-Instruct` | Local model name |
| `ANTHROPIC_API_KEY` | (required for Sonnet/Opus) | API key |
| `CLAUDE_SONNET_MODEL` | `claude-3-5-sonnet-latest` | Sonnet model ID |
| `CLAUDE_OPUS_MODEL` | `claude-3-opus-latest` | Opus model ID |
| `DEFAULT_PROVIDER` | `local` | Starting provider |
| `ESCALATE_PROVIDER` | `sonnet` | Mid-tier escalation |
| `CONTEXT_ESCALATION_TOKENS` | `12000` | Context size trigger |
| `MAX_CONTEXT_MESSAGES` | `12` | Message window before trimming |
| `MAX_INVALID_TOOL_ARGS` | `2` | Failures before escalation |
| `MAX_TOOL_CALL_FAILURES` | `1` | Tool errors before escalation |
| `LOCAL_BACKOFF_SECONDS` | `60` | Local unavailable backoff |
| `MAX_OPUS_CALLS_PER_RUN` | `1` | Cost cap |
| `MAX_SONNET_CALLS_PER_RUN` | `3` | Cost cap |
| `MAX_TOTAL_TOKENS_PER_RUN` | `60000` | Token budget |
| `DAILY_SPEND_LIMIT_SOFT` | `1.00` | Soft daily limit ($) |
| `DAILY_SPEND_LIMIT_HARD` | `5.00` | Hard daily limit ($) |
| `TWO_PASS_CATEGORIES` | `security,architecture` | Two-pass trigger categories |
