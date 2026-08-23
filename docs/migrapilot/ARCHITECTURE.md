# MigraPilot Architecture

> Internal AI copilot for MigraHosting infrastructure management.

## System Overview

```
┌─────────────────┐     SSE/REST     ┌──────────────────┐     Prisma      ┌────────────┐
│   pilot-web      │◄──────────────►  │    pilot-api      │◄──────────────► │  PostgreSQL │
│   Next.js 15     │   :3399→:3377   │    Express 4      │   :5433        │  migra_core │
│   App Router     │                 │    TypeScript     │                └────────────┘
└─────────────────┘                 └──────────────────┘
                                           │
                          ┌────────────────┼────────────────┐
                          ▼                ▼                ▼
                    ┌──────────┐   ┌──────────────┐   ┌──────────┐
                    │  vLLM    │   │  Claude       │   │ Claude   │
                    │  Local   │   │  Sonnet 3.5   │   │ Opus 3   │
                    │  :8000   │   │  Anthropic    │   │ Anthropic│
                    └──────────┘   └──────────────┘   └──────────┘
```

## Component Map

### Backend — `services/pilot-api`

| Component | Path | Purpose |
|-----------|------|---------|
| **Agent Loop** | `services/agentLoop.ts` | Core loop: LLM ↔ tool execution, max 6 iterations |
| **LLM Router** | `services/llm/router.ts` | 3-brain provider selection (local → sonnet → opus) |
| **Policy Engine** | `services/llm/policyEngine.ts` | Scoring matrix, daily budgets, intent classification |
| **Claude Provider** | `services/llm/claudeProvider.ts` | Anthropic Messages API with SSE streaming |
| **Local Provider** | `services/llm/localOpenAIProvider.ts` | vLLM via OpenAI-compat SDK |
| **Safety Policy** | `services/safetyPolicy.ts` | Denylists, pre-flight checks, blast radius, change tickets |
| **RAG Pipeline** | `services/rag/ragPipeline.ts` | Document chunking, keyword search, workspace ingestion |
| **Agents** | `services/agents/` | Multi-agent orchestrator: planner, reviewer, tool, summarizer, incident |
| **Repo Tools** | `services/repo/workspace.ts` | Workspace indexer: search, read, symbols, patch, tests |
| **Logger** | `services/logger.ts` | Structured JSON logging with domain methods |
| **Approval Service** | `services/approvalService.ts` | JWT-based approval tokens for WRITE/DANGER |
| **Idempotency** | `services/idempotencyService.ts` | Args hashing, cached result replay |
| **Audit Service** | `services/auditService.ts` | Append-only audit log |

### Frontend — `apps/pilot-web`

| Component | Path | Purpose |
|-----------|------|---------|
| **PilotShell** | `components/PilotShell.tsx` | Main chat UI with sidebar, streaming, provider badges |
| **DiffViewer** | `components/DiffViewer.tsx` | Unified diff rendering with syntax highlighting |
| **ApprovalModal** | `components/ApprovalModal.tsx` | Enhanced approval with blast radius + rollback |
| **ModeSwitch** | `components/ModeSwitch.tsx` | Operator ↔ Engineering mode toggle |
| **CommandPalette** | `components/CommandPalette.tsx` | `/command` quick actions with keyboard nav |
| **SourcePanel** | `components/SourcePanel.tsx` | RAG source citations panel |
| **Admin Page** | `app/pilot/admin/page.tsx` | Token usage, provider breakdown, daily spend |

### Shared — `packages/tooling`

| File | Purpose |
|------|---------|
| `tools.registry.json` | Tool registry: 30 tools (system, tenant, pod, domain, DNS, mail, WordPress, storage, repo, knowledge) |
| `schemas/tools/tool-inputs.json` | JSON Schema `$defs` for every tool's input |
| `src/registry.ts` | Registry loader |
| `src/runner.ts` | Tool executor with AJV validation + RBAC |

## Data Flow

### Chat Request Flow

```
1. User types message → POST /api/pilot/chat/stream (SSE)
2. chat.ts creates/resumes conversation → runAgentLoop()
3. agentLoop:
   a. Classify intent → taskCategory (operator|engineering|security|architecture|debugging|chat)
   b. RAG search → inject top 3 relevant knowledge chunks into system prompt
   c. Policy engine → evaluatePolicy() → preferred provider + daily budget check
   d. Router → decide() → provider selection (respects policy advisory + cost caps)
   e. Stream from provider → tokens → SSE events to client
   f. If tool_calls → executeAndEmitTool() for each
      - Safety policy check (denylists, tenant scoping)
      - Validation, approval, idempotency gates
      - Execute → record change ticket → emit result
   g. Loop up to 6 iterations for tool chaining
   h. Finalize run with token accounting + daily spend recording
```

### Tool Execution Pipeline

```
executeAndEmitTool()
  │
  ├─ 1. Create PilotToolCall record
  ├─ 2. Audit log: tool.requested
  ├─ 3. Safety policy: checkPolicy() → violations?
  │     ├─ Block → return POLICY_VIOLATION
  │     └─ Warn → log and continue
  ├─ 4. Validate: risk level, dryRun, idempotencyKey
  ├─ 5. If WRITE/DANGER:
  │     ├─ Require idempotencyKey
  │     ├─ If not dryRun → require approvalToken
  │     ├─ Verify approval token (JWT, args hash, expiry)
  │     └─ Check idempotent cache → replay if found
  ├─ 6. Execute via @migra/tool-runner
  ├─ 7. Record result + audit log
  ├─ 8. If WRITE/DANGER success:
  │     ├─ Generate rollback hint
  │     ├─ Calculate blast radius (DANGER only)
  │     └─ Record change ticket in AuditLog
  └─ 9. Emit tool_status event to client
```

## LLM Provider Strategy

MigraPilot uses a **3-brain architecture**:

| Provider | Model | Use Case | Cost |
|----------|-------|----------|------|
| **Local** | Meta-Llama-3-8B | Default for chat, simple queries | Free |
| **Sonnet** | Claude 3.5 Sonnet | Architecture review, complex tools, policy-escalated | $3/$15 per M tokens |
| **Opus** | Claude 3 Opus | Security review, high-stakes, failures, two-pass mode | $15/$75 per M tokens |

### Escalation Triggers

- **→ Sonnet**: architecture review, big context (>12K tokens), repeated tool failures, local unavailable, policy score 3–7
- **→ Opus**: security review, high-risk operations, Sonnet failed, policy score ≥ 8
- **Policy Engine**: Scoring matrix (context size, tool errors, task category, risk level, Sonnet failures) → advisory provider tag

### Cost Caps

| Setting | Default | Purpose |
|---------|---------|---------|
| `MAX_SONNET_CALLS_PER_RUN` | 3 | Per-run Sonnet limit |
| `MAX_OPUS_CALLS_PER_RUN` | 1 | Per-run Opus limit |
| `MAX_TOTAL_TOKENS_PER_RUN` | 60,000 | Token budget per run |
| `DAILY_SPEND_LIMIT_SOFT` | $1.00 | Warning threshold |
| `DAILY_SPEND_LIMIT_HARD` | $5.00 | Force local-only |

## Multi-Agent Architecture

Five specialist agents, coordinated by the orchestrator:

| Agent | Role | When Used |
|-------|------|-----------|
| **Planner** | Breaks task into numbered steps with tool names | Complex multi-step requests |
| **Tool** | Executes approved steps (the default agent) | Every tool execution |
| **Reviewer** | Assesses safety, tenancy, cost, blast radius | Before WRITE/DANGER in complex plans |
| **Summarizer** | Generates Engineering State summary | Every ~10 turns |
| **Incident** | Log/health triage, always starts with READs | ops+health keywords detected |

## Database Schema

Key models in Prisma:
- `PilotConversation` — chat sessions
- `PilotMessage` — user/assistant messages (JSON content)
- `PilotRun` — agent loop executions (model, inputTokens, outputTokens, totalTokens, escalationReason)
- `PilotToolCall` — tool invocations (status lifecycle, idempotencyKey, tenantId)
- `PilotToolResult` — execution results (ok, resultJson, errorJson)
- `PilotApproval` — approval requests/tokens
- `PilotIdempotency` — deduplication cache
- `AuditLog` — immutable audit trail + RAG chunk storage + change tickets

## Security Boundaries

1. **Tenant isolation**: TENANT_SCOPED tools validate `tenantId` matches actor
2. **RBAC**: Tool registry defines `rbac` array per tool
3. **Secret redaction**: All stored/displayed data passes through `redactSecrets()`
4. **Denylists**: Internal domains, system paths, internal buckets blocked
5. **Approval gates**: WRITE/DANGER require signed JWT tokens with args hash
6. **Idempotency**: Mutating operations deduplicated by key + args hash
7. **Audit trail**: Every action logged with actor, tenant, correlation ID
8. **Safety policy**: Pre-execution checks block policy violations before tool runs
