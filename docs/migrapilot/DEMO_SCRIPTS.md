# MigraPilot Demo Scripts

> Scripted demonstrations for each major MigraPilot capability.

## Demo 1: Repo Patch Flow (Engineering Mode)

**Purpose**: Show MigraPilot reading code, finding issues, and applying a patch with approval.

```
1. Switch to Engineering mode (click ⚡ Engineering)
2. Type: "Search the codebase for any TODO comments in the repo workspace"
   → MigraPilot uses repo.search to find TODOs
   → Shows results with file paths and line numbers

3. Type: "Read the file src/services/llm/config.ts and check if all env vars have defaults"
   → Uses repo.readFile to display file content
   → AI analyzes and lists any missing defaults

4. Type: "Show me the symbols in src/services/agentLoop.ts"
   → Uses repo.symbols to list functions, exports

5. Type: "Create a simple helper function in src/utils/formatCost.ts that formats cost to 4 decimal places"
   → MigraPilot generates the code
   → Requests approval (WRITE) → ApprovalModal shown
   → Approve → file created → change ticket recorded

6. Check Sources panel (📚) for any RAG context used
```

**What to observe**:
- Engineering mode filters tool palette to repo commands
- DiffViewer shows changes before approval
- Change ticket recorded in audit log
- Provider badge shows model used (likely Local for simple reads)

---

## Demo 2: Infrastructure Tool Flow (Operator Mode)

**Purpose**: Show the full tool lifecycle: request → validate → approve → execute.

```
1. Switch to Operator mode (click 🔧 Operator)

2. Type: "/health" and select from command palette
   → Quick command inserts system.health tool template
   → Edit correlationId and send
   → System health check executes (READ tool, no approval needed)

3. Type: "List all pods for tenant demo-tenant-01"
   → MigraPilot uses pods.list
   → Shows pod listing in tool card

4. Type: "Create a new pod for tenant demo-tenant-01 with plan basic"
   → Classifies as WRITE → requires idempotencyKey
   → DryRun=checked → shows dry run result
   → Uncheck DryRun and try again
   → ApprovalModal appears with plan summary
   → Approve → pod created → rollback hint shown

5. Type: "Now show me the DNS records for demo-domain.com"
   → Uses dns.lookup → READ tool
```

**What to observe**:
- Dry run mode prevents real execution
- WRITE tools require approval with blast radius
- Tool card shows status lifecycle (requested → started → completed)
- Audit trail for every step

---

## Demo 3: Provider Routing & Escalation

**Purpose**: Demonstrate the 3-brain routing and cost controls.

```
1. Type: "What's the status of our pods?" (simple query)
   → Provider badge: 🟢 Local
   → Simple response from local model

2. Type: "I need to refactor the authentication middleware architecture. How should we restructure it?"
   → Provider badge: 🟡 Sonnet (architecture keyword → escalation)
   → More detailed response from Sonnet

3. Type: "Audit the security of our DNS configuration for potential vulnerabilities"
   → Provider badge: 🔴 Opus (security keyword → highest priority)
   → Comprehensive security analysis

4. Check admin dashboard (/pilot/admin):
   → Token usage by provider
   → Daily spend tracking
   → Escalation reasons logged
```

**What to observe**:
- Provider badge changes based on intent classification
- Policy engine score visible in structured logs
- Cost caps prevent runaway spending
- Daily spend tracked across all sessions

---

## Demo 4: Safety Policy Enforcement

**Purpose**: Show safety policy blocking dangerous operations.

```
1. Type: "Delete the DNS records for migrahosting.com"
   → Safety policy blocks: DENIED_DOMAIN
   → Error: "Domain migrahosting.com is on the internal denylist"
   → No execution occurs

2. Type: "Read the file at /etc/shadow"
   → Safety policy blocks: DENIED_PATH
   → Error: "Path /etc/ is on the denylist"

3. Type: "Purge the migra-internal storage bucket"
   → Safety policy blocks: DENIED_BUCKET
   → Error: "Bucket migra-internal is on the internal denylist"

4. Type: "Delete pod P123 for tenant other-tenant"
   (when logged in as demo-tenant-01)
   → Safety policy blocks: TENANT_MISMATCH
   → Error: "Cannot operate on a different tenant"

5. Type: "Delete pod P456 for tenant demo-tenant-01"
   → Passes safety checks → ApprovalModal with blast radius:
     "Destroys pod P456 for tenant demo-tenant-01. All data in the pod will be lost."
   → Rollback hint: "Rollback: pods.delete with podId from result, tenantId=demo-tenant-01"
```

**What to observe**:
- Denylists prevent operations on MigraHosting infrastructure
- Tenant boundary enforced even when asked explicitly
- DANGER tools show blast radius and rollback hints
- All violations logged with severity

---

## Demo 5: Cost Controls & Budget Guardrails

**Purpose**: Show daily budget enforcement and token limits.

```
1. Set env vars for testing:
   DAILY_SPEND_LIMIT_SOFT=0.01
   DAILY_SPEND_LIMIT_HARD=0.05

2. Have several conversations using Sonnet/Opus

3. After soft limit ($0.01):
   → Warning in logs: "Daily spend exceeds soft limit"
   → Operations continue normally

4. After hard limit ($0.05):
   → Provider forced to Local
   → Message: "Daily budget exceeded. Only local model available."
   → All subsequent requests use 🟢 Local regardless of complexity

5. Check admin dashboard:
   → Daily spend chart shows accumulation
   → Provider breakdown shows forced-local entries

6. Restart server → daily budget resets
```

**What to observe**:
- Soft limit warns but doesn't restrict
- Hard limit forces local-only (free) model
- Per-run token budget (60K) prevents single expensive runs
- All cost data visible in admin dashboard

---

## Quick Verification Checklist

After each demo, verify:

- [ ] Provider badges match expected model
- [ ] Tool cards show correct status progression
- [ ] Safety policy blocks are logged in structured format
- [ ] Approval modal shows blast radius + rollback for DANGER tools
- [ ] Dry run prevents actual execution
- [ ] Admin dashboard shows token usage data
- [ ] Source panel shows RAG citations when relevant
- [ ] Command palette works with / and Cmd+K
- [ ] Mode switch filters available commands
