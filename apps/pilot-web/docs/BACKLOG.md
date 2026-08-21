# Command Center backlog

Findings raised while working the consumer vertical slice. Recorded here rather than fixed
inline, because a baseline commit must not change behaviour and the consumer slice must not
be interrupted. Both are truthfulness defects, not cosmetics.

## 1. Seven "real commandIds" that resolve nowhere

`components/EmptyStateDashboard.tsx` labels its Quick Actions
*"now mapped to real commandIds"*:

| commandId | resolves in this app |
|---|---|
| `system.health_check` | no |
| `tenants.list` | no |
| `pods.create` | no |
| `dns.change_record` | no |
| `code.search` | no |
| `system.verification_demo` | no |
| `system.read_only_demo` | no |

None has a handler anywhere in `apps/pilot-web`. They would belong to the separate
`services/pilot-api` backend, which is unverified from here.

**Not urgent for users today** — `EmptyStateDashboard` is only rendered by `PilotShell`,
which nothing in `app/` mounts (`app/pilot/page.tsx` renders `MigraPilotCommandCenterMock`).
That is *why* it is backlog rather than an incident.

**Required before PilotShell is ever mounted:** each action gets a real handler, or it is
removed. A dashboard of buttons that do nothing is the same class of defect as the fake
project counts removed from the consumer — worse here, because these name operations like
`dns.change_record` and `pods.create` that a user would reasonably believe had run.

## 2. `migrapilot/prompts/inspect.md` is empty

`plan.md`, `execute.md`, `verify.md` and `review.md` all carry content. `inspect.md` is
zero bytes.

That was tolerable when `mode` was decorative. It is not now: Inspect carries real
authority — `lib/pilot/mode-authority.ts` makes it a READ-ONLY ceiling that refuses every
mutating tool call, and the refusal names the mode to the user
(*"Inspect mode understands current state and does not change it"*).

So the mode has an enforced behavioural contract in code and **no stated prompt contract**.
The two must be written together and verified against each other: whatever `inspect.md`
tells the model must not promise anything the ceiling will refuse, and must not omit the
constraint the ceiling enforces. A prompt that contradicts the gate produces exactly the
experience the gate exists to prevent — a model confidently offering to do something, then
being blocked.

**Definition of done:** `inspect.md` states the read-only contract; a check asserts every
mode with a read-only ceiling has a non-empty prompt naming that constraint.
