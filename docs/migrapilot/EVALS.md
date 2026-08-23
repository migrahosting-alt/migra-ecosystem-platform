# MigraPilot — Evaluation Harness

> Automated behavioral tests for the AI agent pipeline.
> Location: `services/pilot-api/src/eval/`

---

## Overview

The eval harness validates that MigraPilot's agent system behaves correctly across security, routing, policy, and quality dimensions. It runs **25 tests** across **8 categories** without requiring live LLM calls.

## Running

```bash
# Run all tests
cd services/pilot-api
npx tsx src/eval/run.ts

# Run a specific category
npx tsx src/eval/run.ts --filter=tenancy

# Run by test name pattern
npx tsx src/eval/run.ts --filter="deny-cross"
```

## Test Categories

### 1. Schema Adherence (3 tests)
Validates that tool inputs match expected JSON schemas and that missing required fields are rejected.

| Test | Description |
|------|-------------|
| `schema-valid-input` | Valid input passes schema validation |
| `schema-invalid-input` | Missing required field is rejected |
| `schema-extra-fields` | Extra fields are stripped or ignored |

### 2. Tenancy Leakage (3 tests)
Ensures strict tenant isolation — no cross-tenant data access.

| Test | Description |
|------|-------------|
| `tenancy-same-tenant` | Same-tenant access is allowed |
| `tenancy-cross-tenant` | Cross-tenant access is denied |
| `tenancy-missing-tenant` | Missing tenantId is rejected |

### 3. Danger Tool Misuse (4 tests)
Validates that DANGER-tier tools require approval and can't bypass safety.

| Test | Description |
|------|-------------|
| `danger-requires-approval` | DANGER tool without approval is blocked |
| `danger-approved-ok` | DANGER tool with approval succeeds |
| `danger-dry-run` | DANGER tool in dry-run gives preview only |
| `danger-no-escalation` | Non-DANGER tool doesn't require approval |

### 4. Policy Enforcement (3 tests)
Tests the policy-as-code engine's rule evaluation.

| Test | Description |
|------|-------------|
| `policy-deny-unknown-tool` | Unknown tool name is denied |
| `policy-deny-internal-domain` | Internal domain in args is caught |
| `policy-budget-gate` | High spend triggers approval |

### 5. Router Decisions (5 tests)
Validates the 3-brain LLM router makes correct provider choices.

| Test | Description |
|------|-------------|
| `router-default-local` | Small context routes to local vLLM |
| `router-escalate-context` | Large context escalates to Sonnet |
| `router-security-review` | Security keywords escalate to Opus |
| `router-budget-exceeded` | Hits token budget → graceful abort |
| `router-local-backoff` | Local failure triggers backoff + escalation |

### 6. Prompt Injection (2 tests)
Validates resistance to prompt injection attacks.

| Test | Description |
|------|-------------|
| `injection-system-override` | System prompt override attempt is blocked |
| `injection-tool-jailbreak` | Encoded tool-call injection is caught |

### 7. Memory Consistency (2 tests)
Validates engineering state persistence and retrieval.

| Test | Description |
|------|-------------|
| `memory-store-retrieve` | State patch is stored and retrievable |
| `memory-summary-trigger` | Summary generation triggers at threshold |

### 8. Golden Runs (3 tests)
End-to-end scenarios that validate complete agent flows.

| Test | Description |
|------|-------------|
| `golden-create-pod` | Full pod creation flow with approval |
| `golden-dns-lookup` | DNS lookup + RAG citation flow |
| `golden-security-audit` | Security audit with Opus escalation + review |

## Adding New Tests

Each test follows this structure:

```typescript
{
  id: "category-descriptive-name",
  category: "category",
  description: "What this test validates",
  run: async () => {
    // 1. Set up test context
    // 2. Call the function being tested
    // 3. Assert expected behavior
    return { pass: true }; // or { pass: false, reason: "why it failed" }
  },
}
```

Add tests to the appropriate category array in `eval/harness.ts`, then run:

```bash
npx tsx src/eval/run.ts --filter=your-test-id
```

## CI Integration

```yaml
# .github/workflows/eval.yml
name: MigraPilot Evals
on: [push, pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd services/pilot-api && npm ci
      - run: cd services/pilot-api && npx tsx src/eval/run.ts
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |

The harness prints a summary table with pass/fail status and timing for each test.
