# Control Center — Overview (`/console`) truth audit

**Audited release:** `20260908-suspend-truthfulness` (live on app-core since 2026-09-08 18:55:52 UTC)
**Audited source:** commit `d41131e1b1b5d02930d32f242d037436e53bcb91` — the immutable, reproducible
capture of that exact release (Phase A). **Not** the working tree, which differs from production.
**Audit date:** 2026-09-09.

Probe states below were verified by executing the console's own probe targets from app-core at
audit time, not read off the UI.

---

## 0. Headline finding — the Healthy/Unknown contradiction

`Internal service health` says **Healthy** for Hosting, MigraPanel, Voice, Email, Intake and
Marketing. `Ecosystem Control Grid` says **Unknown** for those same six products, on the same
page, in the same render.

Both panels are individually defensible. The contradiction is real anyway, and here is the
mechanism:

| | Internal service health | Ecosystem Control Grid |
|---|---|---|
| Source | `lib/health.ts` → live HTTP probe, TTL 60s | `lib/ecosystem.ts` → `unknownHealth(...)` **literal** |
| Evidence | real: observedAt, latency, HTTP code, source | none — never computed |
| Word for `operational` | **"Healthy"** (`UniversePanels.tsx:146`) | **"Operational"** (`EcosystemGrid.tsx`) |

Three separate defects are stacked here:

1. **The grid's health is a hard-coded constant.** Every one of the 10 tiles gets
   `health: unknownHealth(...)` unconditionally. No input can ever change it. By the standing
   rule ("constant / default / placeholder = defect") this is a defect even though it fails
   *closed* rather than open.
2. **The grid's stated reason is false.** It reads *"no product health observation source exists
   yet"*. For the six products whose service **is** probed, a source does exist — it is rendered
   four inches higher on the same page. The tile does not lack evidence; it declines to read it.
3. **The canonical resolver already exists and has zero callers.**
   `lib/fleet/health-contract.ts` exports `deriveProductHealth(deps, evidence)` — exactly the
   dependency→product resolver Phase C calls for, already written, already pure and unit-testable.
   `grep -rn deriveProductHealth` returns **one hit: its own definition.** Nothing consumes it.

So the fix is *not* "make the tile copy the probe result" — that would reintroduce the
"tile borrows another product's health" defect the code was written to prevent. The fix is to
declare each product's dependencies and route the existing observations through the existing
resolver, leaving genuinely unobserved products UNKNOWN with a **true** reason.

**Live probe results at audit time** (run from app-core, the same vantage point the console uses):

| Service | HTTP | Mapped state |
|---|---|---|
| MigraTeck Core (`:3111/api/health`) | 404 | **Degraded** (correct — endpoint really is missing) |
| Hosting (MH) — edge origin, Host: migrahosting.com | 301 | Healthy |
| MigraPanel (MP) — `:3020/health` | 200 | Healthy |
| Voice (MV) — `:3003/health` | 200 | Healthy |
| Email (MM) — `:3010/api/webmail/health` | 200 | Healthy |
| Intake (MI) — `:4000/` | 200 | Healthy |
| Marketing (MK) — `:4300/` | 200 | Healthy |
| Automation (AU) | *(no target)* | Unknown — "no distinct automation service is deployed" |

The six "Healthy" readings in the screenshot are **evidence-backed and correct**. The Unknowns
beneath them are not.

---

## 1. Every visible datum

Legend for **Hard-coded?** — `LITERAL` = value is a constant in source; `REGISTRY` = value derived
from a static in-repo registry captured by hand; `LIVE` = queried/observed per request.

### Estate overview

| UI element | Current source | Hard-coded? | Current correctness | Desired authority | Action required |
|---|---|---|---|---|---|
| Nodes (25) | `ESTATE.length`, `lib/fleet/estate.ts` | REGISTRY — hand-reconciled from `qm list`+`pct list` on 2026-09-06 | True at capture. **Never expires** — a literal cannot go stale, so drift is invisible | Estate reconciler emitting `observedAt`+TTL | Give the registry an observation wrapper; show age; flag drift |
| Active nodes | `alertableNodes()` — `lifecycleState` filter over same array | REGISTRY | Correct *by definition* (administrative intent, explicitly not health) | Same registry, unchanged semantics | Keep; label as intent, not state |
| Probed services (8) | `SERVICES.length`, `lib/health.ts` | LITERAL array | True (it counts its own list) | Backend service registry (§3 of work order) | Move list behind the API |
| Active websites | panel DB `websites.status='active'` | LIVE | Correct; `null` + reason when DB unconfigured | Keep | None |
| Clients | panel DB `tenants WHERE is_active` | LIVE | Correct; `null` + reason when DB unconfigured | Keep | None |
| Active incidents | `value: null` | LITERAL null | **Honest** — renders "—" with reason "no incident aggregation layer exists yet" | Incident aggregation layer | Build the layer (not an Overview task) |

### Requires attention

| UI element | Current source | Hard-coded? | Current correctness | Desired authority | Action required |
|---|---|---|---|---|---|
| Degraded/down service items | Live probe verdicts | LIVE | Correct, carries `observedAt` | Keep | None |
| "5 VMs have no qemu-guest-agent" | `guestAgent: "absent"` on 5 registry nodes | REGISTRY (2026-09-06) | True at capture; cannot self-refresh | Live hypervisor introspection | Re-observe; add age |
| "N job runs in pre-lease running state" | panel DB `job_runs.status='running'` | LIVE | Correct | Keep | None |
| "7 addresses not confirmed from a running guest" | `provenance: "unverified"` × 7 | REGISTRY (2026-09-06) | True at capture | Guest-verified discovery | Re-observe; add age |
| Scope statement under the heading | LITERAL string | LITERAL | **Correct and load-bearing** — stops an empty list reading as "all clear" | Keep | None |
| Item → object drill-in | *absent* | — | Items name affected objects in prose but do not link to them | Per-item `href` to the object | **Add** (work order §6) |

### Internal service health

| UI element | Current source | Hard-coded? | Current correctness | Desired authority | Action required |
|---|---|---|---|---|---|
| Service list (8 rows) | `SERVICES` in `lib/health.ts` | LITERAL array | Endpoints verified reachable before being written | Backend service registry | Move behind API |
| State / Observation / Latency / Source | Live probe + `health-contract` | LIVE, TTL 60s | **Correct.** HTTP mapped honestly (401/403 → operational, 4xx → degraded, 5xx → down, throw → unknown) | Keep — this is the reference implementation | None |
| Uptime % | *removed* | — | Correctly absent — no uptime history is stored | Keep absent until history exists | None |

### Ecosystem Control Grid

| UI element | Current source | Hard-coded? | Current correctness | Desired authority | Action required |
|---|---|---|---|---|---|
| Tile identity, subtitle, logo, accent | `PRODUCT_LOGOS` / `ACCENTS` / `fallback()` args | LITERAL | Cosmetic, but scattered | Product registry behind the API | Move behind API (§3) |
| **Tile health (all 10)** | `unknownHealth(...)` | **LITERAL — unconditional** | **DEFECT** — never computed; reason string is false for the 6 probed products | `deriveProductHealth()` over declared dependencies | **Phase C** |
| `usagePct` | 8 real panel-DB queries | LIVE | Computed correctly — but **never rendered** (deliberately removed: 8 different denominators under one word "Usage") | Per-tile self-describing metric | Either render with its own denominator, or delete the queries |
| Primary/secondary actions | `fallback()` args | LITERAL | All resolve to built routes (verified) | Registry-declared capabilities | Move behind API (§7) |

### Business operations

| UI element | Current source | Hard-coded? | Current correctness | Desired authority | Action required |
|---|---|---|---|---|---|
| Billing | `value={null}` | LITERAL null | Honest — "—" + "no verified current alert source" | Billing alert source | Build source |
| Support | `lib/support-tickets.ts` | LIVE | **Correct, and carefully so** — canonical predicate `mode='human' AND status NOT IN ('closed','resolved')`, shared with `/console/support` so the two cannot drift | Keep | None |
| Security | `lib/security-observations.ts` | LIVE + **coverage test** | **Correct** — distinguishes "no anomalies" from "no telemetry"; returns null when `failed_login_attempts` has never received a row | Keep | None |
| Infrastructure | `universe.estate[0]?.value` (= Nodes) | REGISTRY | Value correct. **Its `reason` is dead code**: `reason="estate not reconciled"` only renders when the value is null, and `ESTATE.length` is never null — and the estate *was* reconciled, so the string is also untrue | Same as Nodes | Remove or correct the dead reason |

### Unified activity feed

| UI element | Current source | Hard-coded? | Current correctness | Desired authority | Action required |
|---|---|---|---|---|---|
| Feed rows | panel DB `audit_events` | LIVE | Correct when `audit_events` has rows | Keep | None |
| Feed rows — **fallback path** | If `audit_events` returns 0 rows, a UNION over `mailboxes`/`domains`/`invoices`/`websites` **creation timestamps** | LIVE, but **silent source switch** | Rows are real, but object-creation timestamps are presented as *activity*, and **the UI cannot tell which source it is showing** | One declared source, or an explicit "showing derived activity" label | **Label the source** or drop the fallback |

### Top bar

| UI element | Current source | Hard-coded? | Current correctness | Desired authority | Action required |
|---|---|---|---|---|---|
| Bell badge | `universe.attention.length` | LIVE | Correct; hidden at 0, aria says "nothing flagged" — a real measured 0 | Keep | None |
| Messages badge | `openTickets ?? 0` | LIVE | Badge correct (hidden at 0). **But the accessible name is not**: an *unmeasured* count coerces to 0 and the `aria-label` then announces **"Support (no open tickets)"** — an affirmative false all-clear to assistive tech, the exact defect class this page avoids visually | Pass `null` through to the label | **Fix** — announce "count unavailable" when unmeasured |
| Profile pill | session | LIVE | Correct | Keep | None |

---

## 2. Every control (work-order §5 classification)

**Result: every interactive element on `/console` is `NAVIGATION`. There are zero mutations on
the Overview page.** No `<form>`, no `action={}`, no `"use server"`, no non-GET `fetch` in
`page.tsx`, `EcosystemGrid`, `UniversePanels`, `QuickActions`, `ActivityFeed`, `TopBar`,
`CreateNewMenu` or `Sidebar`.

| Control | Classification | Verified |
|---|---|---|
| Create New (top bar) → 9 items | NAVIGATION | Disclosure `<button>` + `<Link>` items |
| Ecosystem tile "Open" × 10 | NAVIGATION | `<Link>` |
| Ecosystem tile secondary: Operations, Domains, Staff, Tickets, Inbox, Analytics ×2, Failures, Compliance, Play Store | NAVIGATION | `<Link>`; Compliance + Play Store leave to external origins by design |
| "Manage Ecosystem" | NAVIGATION | `<Link>` |
| Quick Actions "Create" × 9 / "Open" × 9 | NAVIGATION | `<Link>` — "Create" opens a form, it does not create |
| Estate stat cells (linked when measured) | NAVIGATION | `<Link>`; correctly *not* linked when unmeasured |
| Business-operations tiles × 4 | NAVIGATION | `<Link>` |
| "Open Infrastructure" | NAVIGATION | `<Link>` |
| Bell / Messages / Profile | NAVIGATION | `<Link>` |

**Link-target integrity:** all 23 distinct `/console` targets used by Overview were checked
against the 76 routes actually produced by building `d41131e1`. **0 dead links.**

The one naming risk: Quick Actions labels a navigation control **"Create"**. It opens a creation
form and creates nothing. That is not a false success — but under the work order's vocabulary it
should read as navigation.

---

## 3. Summary — what Phase C and D must change

**Phase C (canonical observation):**
1. Route Ecosystem Control Grid health through the existing `deriveProductHealth()`; declare each
   product's required/optional dependencies. Remove the unconditional `unknownHealth` literal.
2. Unify state vocabulary — one label map, not "Healthy" in one panel and "Operational" in another.
3. Give the estate registry an observation wrapper so registry-sourced facts carry an age.
4. Label or remove the activity-feed fallback source.

**Phase D (controls):** nothing to *remove* — Overview has no fake mutations. Work is:
5. Fix the messages `aria-label` false all-clear.
6. Add per-item drill-in from Requires attention to the responsible object.
7. Remove the dead/untrue `reason` on the Infrastructure tile.

**Not defects, keep as-is:** `lib/health.ts`, `support-tickets.ts`, `security-observations.ts`,
`health-contract.ts`, the Requires-attention scope statement, and every deliberate `null` +
reason. These are the pattern the rest of the Control Center should copy.

---

## 4. Phase C + D — implemented and verified

Branch `feat/console-overview-canonical-observation`, based on `d41131e1` (the live release),
**not** on the working tree. That choice is evidence-driven: the working tree's `lib/health.ts`
still probes **public hostnames** from inside the estate — the exact hairpin error production was
rewritten to fix — so the working tree is the older generation for this module and building on it
would have regressed the console.

### What changed

| # | Change | File(s) |
|---|---|---|
| C1 | **One probe pass per page.** `loadServiceHealth()` is called once in `page.tsx`; the same array is handed to `loadUniverse(services)` and `loadEcosystem(services)`. Both are now required parameters, so a future caller cannot reintroduce a second independent observation without the type checker objecting. | `page.tsx`, `lib/universe.ts`, `lib/ecosystem.ts` |
| C2 | **Grid health is derived, not asserted.** New `PRODUCT_DEPENDENCIES` graph + `productHealth()` feed the pre-existing `deriveProductHealth()`. The unconditional `unknownHealth(...)` literal is gone. Derived verdicts expire with their **oldest** input, so a product can never outlive its evidence. | `lib/ecosystem.ts` |
| C3 | **One vocabulary.** New `components/HealthState.tsx` owns the single label map, dot map and provenance line. Both panels import it; neither defines its own. | `components/HealthState.tsx`, `EcosystemGrid.tsx`, `UniversePanels.tsx` |
| C4 | **Registry age is stated.** `ESTATE_RECONCILED_AT` is exported and rendered — "node registry reconciled 2026-09-06 · website and client counts are live" — so a hand-captured literal is no longer read as a live measurement. | `lib/fleet/estate.ts`, `lib/universe.ts`, `UniversePanels.tsx` |
| C5 | **Activity feed declares its source.** `loadRecentActivity()` returns `{events, source, sourceLabel}`; the silent fallback to object-creation timestamps is now labelled on the panel. | `lib/activity.ts`, `ActivityFeed.tsx` |
| D6 | **Attention items drill in.** Each item carries an `href`; the panel renders "Review affected objects →". | `lib/universe.ts`, `UniversePanels.tsx` |
| D7 | **False accessible name fixed.** `messages` is now `number \| null`. An unmeasured ticket count is announced as "Support (open ticket count unavailable)" instead of "Support (no open tickets)". | `page.tsx`, `TopBar.tsx` |
| D8 | **Dead reason removed.** The unreachable, untrue `reason="estate not reconciled"` is replaced. | `page.tsx` |
| — | `ecosystem/page.tsx` updated for the new `loadEcosystem` signature (required by C1). | `ecosystem/page.tsx` |

### Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | **exit 0** — confirmed to cover 181 console files via `--listFiles` |
| `pnpm run build` | **exit 0**, compiled successfully |
| `pnpm run lint` | **exit 2 — PRE-EXISTING.** `Cannot find package 'eslint-config-next'`. Reproduced identically on the untouched baseline with the changes stashed, so it is an environment/dependency gap, not a regression |
| `tests/product-health-derivation.mjs` | **17/17 PASS** — behavioural, runs the real `health-contract` module: operational→Healthy with provenance, down→Down, optional-degraded→Degraded, unknown→Unknown, expired→Unknown, and "operational" unconstructable without a source and TTL |
| `tests/overview-observation.mjs` | **14/14 PASS** — real browser against a real build: logs in, reads both panels from rendered DOM, asserts all six products agree with their dependency, no "Operational" wording, the false reason string is gone, registry age rendered, activity source rendered, drill-in navigates, aria-label truthful, zero console errors |

### ⚠ What is NOT yet proven

The verification workstation **cannot reach the internal `10.10.0.x` network**, so every probe times
out there and all states render `Unknown`. That proves the *consistency* property (both panels
agree, and the reasons are now specific and true — "no current observation for required dependency:
Hosting (MH)") and the derivation is proven deterministically by the behavioural harness — but the
**green path has not been seen in a live browser**. It will be visible the moment this runs where
the probes succeed, which is Phase E.

**Phase E is the gate: deploy the candidate, then Bonex validates `/console` himself.** Not done —
deployment requires explicit approval.
