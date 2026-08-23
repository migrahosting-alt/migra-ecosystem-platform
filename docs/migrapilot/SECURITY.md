# MigraPilot Security Model

> All security boundaries and enforcement mechanisms.

## Threat Model

MigraPilot is an internal tool accessible to MigraHosting operators and engineers. The threat model addresses:

1. **Accidental blast radius** — operator accidentally deletes wrong tenant's resources
2. **LLM hallucination** — AI fabricates tool calls or invents arguments
3. **Secret leakage** — API keys or tokens exposed in logs, LLM context, or UI
4. **Tenant boundary violation** — operations crossing tenant boundaries
5. **Cost runaway** — uncontrolled LLM spending from complex loops
6. **Internal infrastructure exposure** — AI accessing MigraHosting's own resources

## Security Layers

### 1. Authentication

- **JWT tokens** stored in localStorage, sent via `Authorization: Bearer <token>`
- Token verification extracts `ActorContext: { userId, role, tenantId, token }`
- All API routes require valid JWT (except health check)

### 2. RBAC

Every tool in `tools.registry.json` has an `rbac` array:
```json
{ "name": "pods.delete", "risk": "DANGER", "rbac": ["superadmin", "ops"] }
```

Roles hierarchy:
- `superadmin`: All operations including repo writes and DANGER operations
- `ops`: Infrastructure operations (pods, domains, DNS, mail, storage)
- `support`: Read-only operations and read-only repo tools

### 3. Tenant Isolation

- Tools marked `tenancy: "TENANT_SCOPED"` require `tenantId` in arguments
- Safety policy verifies `args.tenantId === actor.tenantId`
- Cross-tenant operations are blocked with `TENANT_MISMATCH` error
- Tools marked `tenancy: "INTERNAL_ONLY"` skip tenant checks (repo, knowledge, system)

### 4. Safety Policy (Pre-execution)

`safetyPolicy.ts` runs before every tool execution:

**Denylists:**
- Domains: `migrahosting.com`, `migrateck.com`, `migrapanel.com`, `mpanel.migrahosting.com`
- Paths: `/etc/`, `/root/`, `/opt/mpanel/`, `/var/lib/`
- Buckets: `migra-internal`, `migra-backups`, `migra-secrets`

**Violations:**
- `UNKNOWN_TOOL` → Block (tool not in registry)
- `MISSING_TENANT` → Block (TENANT_SCOPED without tenantId)
- `TENANT_MISMATCH` → Block (cross-tenant attempt)
- `DENIED_DOMAIN` → Block (internal infrastructure)
- `DENIED_PATH` → Block (system paths)
- `DENIED_BUCKET` → Block (internal storage)

### 5. Schema Validation

- Every tool has a JSON Schema in `tool-inputs.json`
- `additionalProperties: false` prevents injection of extra fields
- Validated by AJV before execution in tool-runner
- Pattern constraints on tenantId, correlationId, domain names

### 6. Approval Gate

WRITE/DANGER tools require a two-step approval:

```
1. LLM requests tool call
2. agentLoop checks risk level
3. If WRITE/DANGER and not dryRun:
   a. Create approval request (PilotApproval record)
   b. Return APPROVAL_REQUIRED to client
   c. User sees ApprovalModal with blast radius + rollback hints
   d. User approves/denies
   e. Signed JWT approval token generated
   f. Token verified: args hash match, expiry check
   g. Only then execute
```

### 7. Idempotency

- All WRITE/DANGER tools require `idempotencyKey`
- Args are hashed (`sha256(JSON.stringify(sortedArgs))`)
- Before execution, check `PilotIdempotency` table
- If match found → replay cached result (skip execution)
- After execution → store result for future deduplication

### 8. Secret Redaction

`redactSecrets()` in `json.ts`:
- Scans all object keys for: `secret`, `token`, `password`, `apiKey`, `authorization`
- Replaces values with `"•••"`
- Applied to: stored args, stored results, LLM messages, SSE events, UI display

### 9. LLM Secret Isolation

- API keys (`ANTHROPIC_API_KEY`, `LOCAL_OPENAI_API_KEY`) loaded in `config.ts` only
- Never included in LLM messages or system prompt
- System prompt explicitly instructs: "Secrets must never appear in your responses"
- Claude Provider performs additional redaction on streamed output

### 10. Audit Trail

Every action recorded in `AuditLog`:
- `tool.requested` — tool call initiated
- `tool.started` — execution began
- `tool.completed` / `tool.failed` — outcome
- `change.ticket` — WRITE/DANGER change record with blast radius + rollback
- `rag.chunk` — knowledge ingestion records

Fields: `actorId`, `tenantId`, `action`, `resource`, `afterJson`, `correlationId`, `createdAt`

### 11. Repo Security

Workspace tools (`services/repo/workspace.ts`) enforce:
- **Deny patterns**: `node_modules`, `.git`, `.env`, `secrets`, `.pem`, `.key`, `id_rsa`, `.ssh`
- **Path traversal prevention**: `safePath()` resolves relative to WORKSPACE_ROOT, blocks `..` escapes
- **Allowlisted test suites**: Only `unit`, `integration`, `lint` — no arbitrary shell execution
- **No shell access**: No `exec(arbitrary_command)` — only predefined commands

### 12. Cost Controls

- Per-run token budget: `MAX_TOTAL_TOKENS_PER_RUN` (60,000 default)
- Per-run provider caps: `MAX_SONNET_CALLS_PER_RUN` (3), `MAX_OPUS_CALLS_PER_RUN` (1)
- Daily spend tracking: soft warning at $1, hard cap at $5 (forces local-only)

## Incident Response

If a security incident is detected:
1. Check `AuditLog` for full action chain filtered by `correlationId`
2. Use change tickets (`action: "change.ticket"`) to identify what was modified
3. Rollback hints are stored with each change ticket
4. Blast radius recorded for all DANGER operations
