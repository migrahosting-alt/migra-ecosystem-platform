# Control Center — Ecosystem (`/console/ecosystem`) truth audit

**Module 2, Phase A. Read-only. No mutation work, no redesign.**

**Audited source:** `MigraTeck/apps/web/src/app/console/ecosystem/page.tsx` (166 lines) and
`lib/ecosystem.ts`, as deployed in release `20260910-overview-launchpad`
(BUILD_ID `cI_chPSURQZLe5TSs0gVZ`, commit `06596478`) — the release currently live.

---

## 0. What the page actually is

One flat grid of **10 product tiles** plus a 5-figure header row. Every tile is a `<Link>`.
There are **no `<form>`s, no `"use server"` actions, no non-GET fetches** anywhere in the page tree.

> **The subtitle reads `"10 products under unified control"`.**
> Nothing on this page controls anything. The only affordance is Open. That sentence is a
> capability claim with navigation behind it — the same defect the Overview AI bar was removed for
> ("Ask AI to monitor, create, automate…" that ran a ticket search).

**There is no product Control API anywhere in the console.** The entire console exposes five API
routes — `api/login`, `api/logout`, `api/search`, `api/support/conversations/[id]`, and
`api/infrastructure/lifecycle` — and only the last is a mutation surface. `grep -r "capabilities"`
across the console returns **only markdown documents**. So for Module 2's target architecture, the
honest baseline is: **control API availability = NONE for all 10 products; supported capabilities =
unknown, because nothing can be asked.**

---

## 1. 🚨 The model is flattened — PRODUCT ≠ SERVICE INSTANCE ≠ DEPLOYMENT ≠ HOST

This is the structural finding, and it is the reason the page cannot answer the module's question.

The page has exactly **one** level: a product tile. Underneath each tile the real estate looks like
this (hosts confirmed live from the hypervisor, `qm list` on pve):

| Product (what the tile shows) | Service instance it is actually probed by | Host / VM (invisible on this page) |
|---|---|---|
| MigraTeck | `migrateck-core` → `127.0.0.1:3111/api/health` | app-core (VMID 110) |
| Hosting | `hosting` → edge origin w/ Host header | nginx-proxy-core (VMID 102) |
| MigraPanel | `panel` → `:3020/health` | MigraPanel-Core (VMID 107) |
| Voice | `voice` → `:3003/health` | app-core / VOIP-CORE (VMID 104) |
| Email | `email` → `:3010/api/webmail/health` | mail-core (VMID 108) / edge |
| Intake | `intake` → `:4000/` | app-core (VMID 110) |
| Marketing | `marketing` → `:4300/` | app-core (VMID 110) |
| Automation | *(no probe target)* | — |
| AnnouPale | *(no dependency declared)* | **annoupale-core (VMID 113)** |
| Pale | *(no dependency declared)* | app-core (pale-api colocated) |

Three products (MigraTeck, Intake, Marketing) run on the **same host**; a host outage would take
three tiles down at once and the page could not express why. AnnouPale has its **own VM** that the
page never mentions. Nothing shows a deployment, a release, or a version.

⭐ **The tile is currently doing the job of all four concepts at once**, which is exactly what the
target model separates:

```
Product
  ├─ lifecycle        ← does not exist on this page
  ├─ health           ← present (derived, correct)
  ├─ dependencies     ← exists in lib/ecosystem.ts, NOT surfaced in the UI
  ├─ deployments      ← does not exist
  ├─ service instances ← exists in lib/health.ts, NOT surfaced here
  ├─ control API      ← does not exist
  └─ capabilities     ← does not exist
```

---

## 2. Per-item audit

`identity/type/owner` are read from the tile literals; `health`/`evidence`/`dependencies` from
`lib/ecosystem.ts` + `lib/health.ts`.

| Product | Type | Deployment state | Lifecycle | Health evidence | Dependencies | Control API | UI actions | Backend behaviour |
|---|---|---|---|---|---|---|---|---|
| MigraTeck | internal platform | not represented | not represented | derived from `migrateck-core` probe (live, TTL 60s) | 1 required | none | Open | navigation only |
| Hosting | product | not represented | not represented | derived from `hosting` probe | 1 required | none | Open | navigation only |
| MigraPanel | product | not represented | not represented | derived from `panel` probe | 1 required | none | Open | navigation only |
| Voice | product | not represented | not represented | derived from `voice` probe | 1 required | none | Open | navigation only |
| Email | product | not represented | not represented | derived from `email` probe | 1 required | none | Open | navigation only |
| Intake | product | not represented | not represented | derived from `intake` probe | 1 required | none | Open | navigation only |
| Marketing | product | not represented | not represented | derived from `marketing` probe | 1 required | none | Open | navigation only |
| Automation | product | not represented | not represented | **UNKNOWN** — "no distinct automation service is deployed" | 1 required, unprobeable | none | Open | navigation only |
| AnnouPale | external product | not represented | not represented | **UNKNOWN** — no dependency declared | **none** | none | Open | navigation only |
| Pale | external product | not represented | not represented | **UNKNOWN** — health probed inside `/console/pale`, not here | **none** | none | Open | navigation only |

**Owner / business unit: not modelled anywhere.** No product carries an owner, business unit, or
tier. Per `reference_entity_brand_model` these are distinct brands (MigraHosting is the hosting
brand, MigraTeck the platform), but the page cannot express that.

---

## 3. Hard-coded values

| # | What | Where | Severity |
|---|---|---|---|
| 1 | **Third status vocabulary.** `STATUS_DOT` + `STATUS_BADGE` are redefined locally, and the tile renders `{health.state}` **raw** with `capitalize` → the operator sees **"Operational"**. The Overview grid renders the same state through `components/HealthState.tsx` as **"Healthy"**. | `ecosystem/page.tsx:14-26`, `:143` | **HIGH — cross-module** |
| 2 | **Second route authority.** `ROUTE_FOR` overrides `tile.primaryAction.href`. They **diverge for 4 of 10** products. | `ecosystem/page.tsx:28-38` | **HIGH** |
| 3 | **`"under unified control"`** — capability claim, zero controls | `:65` | **HIGH** |
| 4 | **`Avg Activity`** averages `usagePct` across tiles whose denominators are **8 different things** | `:53-54`, `:82-86` | **HIGH** |
| 5 | **Activity bar + `%`** rendered per tile from those same incommensurable denominators | `:120-135` | MEDIUM |
| 6 | **`usagePct: 0`** hard-coded for AnnouPale and Pale → renders an **empty 0.0% bar**, which reads as "no activity" rather than "not measured" | `lib/ecosystem.ts` | **HIGH** |
| 7 | Product list, names, subtitles, logos, accents are literals in `lib/ecosystem.ts` | `lib/ecosystem.ts` | MEDIUM (registry) |
| 8 | `PRODUCT_DEPENDENCIES` is a literal map; AnnouPale and Pale have **no entry at all** | `lib/ecosystem.ts` | MEDIUM |
| 9 | "Total Products" = `tiles.length` — the length of a hard-coded array | `:69` | LOW |

### 3.1 The route divergence, in full

| Product | Ecosystem `ROUTE_FOR` | Overview `primaryAction` | |
|---|---|---|---|
| MigraTeck | `/console` | `/console/ecosystem` | diverge |
| **MigraPanel** | **`https://control.migrahosting.com/client/login`** (new tab) | **`/console/clients`** | **diverge — see below** |
| AnnouPale | `/console/annoupale` | `/console/annoupale` (tile action) | tile secondary differs |
| Pale | `/console/pale` | `/console/pale` (tile action) | tile secondary differs |
| the other 6 | — | — | agree |

🚨 **MigraPanel is the serious one.** The same product, the same word **"Open"**, in the same
console: from Overview it opens the **internal staff client list**; from Ecosystem it opens the
**customer-facing login portal in a new tab**. An operator cannot predict which product they will
land in. All 11 route targets do exist as pages — this is not a dead link, it is a *wrong* one.

### 3.2 Why "Avg Activity" cannot mean anything

`usagePct` is computed per product from a different denominator each time:

```
MigraTeck   % of users who logged in within 7 days
Hosting     % of websites whose status is active
MigraPanel  audit_events in 24h vs the trailing 7-day daily average
Voice       % of phone extensions enabled
Email       % of mailboxes active
Intake      growth_leads in 30d vs (builder_form_bindings x 30)
Marketing   % of this quarter's GBP posts that are published
Automation  % of job runs in 7d that succeeded
AnnouPale   0   (hard-coded — no panel-DB metric exists)
Pale        0   (hard-coded — no panel-DB metric exists)
```

Averaging these produces a figure that answers no question, and the two hard-coded zeros drag it
down by construction. **Overview already removed the per-tile "Usage" number for exactly this
reason** — the comment in `EcosystemGrid.tsx` says so explicitly. Ecosystem still renders both the
per-tile bar *and* an average of them.

---

## 4. What is already correct — keep it

- **Health derivation is right.** The page consumes `loadEcosystem(await loadServiceHealth())`, the
  same one-observation contract established in Module 1, and applies expiry at render time via
  `current()`. Grid and table cannot disagree on *state*.
- **Provenance is shown** next to every tile ("derived from Hosting (MH) · verified 0s ago", or the
  reason when unknown).
- **The unknowns are honest.** Automation, AnnouPale and Pale each state a true reason.
- No fabricated health, no fake success, no dead links.

---

## 5. Recommended Phase B scope (for approval — not started)

1. **One vocabulary.** Delete `STATUS_DOT`/`STATUS_BADGE`; import `HealthState.tsx`. Kills the
   "Operational" vs "Healthy" split across two pages.
2. **One route authority.** Delete `ROUTE_FOR`; use the registry. Decide deliberately what
   MigraPanel's "Open" means, and if the customer portal is wanted, label it as such and not "Open".
3. **Stop claiming control.** Fix the subtitle until real capabilities exist.
4. **Remove `Avg Activity`,** and either give each tile a metric that names its own denominator or
   remove the bar — the Overview precedent is to remove.
5. **Never render a hard-coded 0 as a measurement** — AnnouPale/Pale must show "not measured".
6. **Introduce the four-level model** in the read model first: product → service instances →
   deployment → host, surfacing what `lib/health.ts` and `fleet/estate.ts` already know. This is the
   step that makes capability-driven control possible later.
7. Only then: a product Control API with `GET /resources/:id/capabilities`, and a UI that renders
   what the backend declares.


---

## 6. LIVE EVIDENCE — captured from production, 2026-09-10

Release `20260910-overview-launchpad`, BUILD_ID `cI_chPSURQZLe5TSs0gVZ`, read through an
operator-established session. Read-only.

### 6.1 Header aggregates as rendered

```
10 products under unified control
TOTAL PRODUCTS 10   OPERATIONAL 6   DEGRADED 1   UNVERIFIED 3   AVG ACTIVITY 29.2%
                                                                "usage index across all modules"
```

### 6.2 Tiles as rendered

| Tile | State word | Activity | Destination |
|---|---|---|---|
| MigraTeck | Degraded | 0.0% | `/console` |
| Hosting | Operational | **91.7%** | `/console/hosting` |
| MigraPanel | Operational | 0.0% | **`https://control.migrahosting.com/client/login` — NEW TAB, EXTERNAL** |
| Voice | Operational | **100.0%** | `/console/voice` |
| Email | Operational | **100.0%** | `/console/email` |
| Intake | Operational | 0.0% | `/console/intake` |
| Marketing | Operational | 0.0% | `/console/marketing` |
| Automation | Unknown | 0.0% | `/console/automation` |
| AnnouPale | Unknown | 0.0% | `/console/annoupale` |
| Pale | Unknown | 0.0% | `/console/pale` |

Every tile has exactly one affordance: **Open →**.

### 6.3 🚨 The vocabulary split, proven live

Same release, same moment, same underlying state — **6 of 10 products are labelled differently on
the two pages**:

```
Hosting      Overview="Healthy"   Ecosystem="Operational"
MigraPanel   Overview="Healthy"   Ecosystem="Operational"
Voice        Overview="Healthy"   Ecosystem="Operational"
Email        Overview="Healthy"   Ecosystem="Operational"
Intake       Overview="Healthy"   Ecosystem="Operational"
Marketing    Overview="Healthy"   Ecosystem="Operational"
MigraTeck / Automation / AnnouPale / Pale  — same word on both
```

Module 1 unified the *state*; the *word* is still split, because Ecosystem never adopted
`components/HealthState.tsx`.

### 6.4 🚨 "Avg Activity 29.2%" and seven empty bars

**7 of 10 tiles render 0.0% with an empty progress bar.** Visually the page says most of the
ecosystem is idle. It is not: MigraPanel is Operational at 0.0% because its metric is *audit events
in 24h vs a trailing 7-day average*; AnnouPale and Pale are hard-coded 0 because no panel-DB metric
exists for them at all. Meanwhile Voice and Email read 100.0% — those are *% of extensions enabled*
and *% of mailboxes active*, which are near-100 by construction.

**29.2% is the mean of eight different denominators plus two hard-coded zeros.** It is presented as
a "usage index across all modules". It indexes nothing.

### 6.5 Provenance is present but unreadable

Every tile carries its provenance — correct, and inherited from Module 1 — but at the rendered width
it truncates to `derived from MigraTeck Co…`, `derived from Hosting (…`. The honest data is there
and the operator cannot read it.

### 6.6 🚨 CROSS-MODULE: 47 pages still have the responsive defect Overview fixed

The Ecosystem page **overflows horizontally at both 390px and 768px** — measured live.

Root cause is the same one fixed in Module 1, in a different file. Overview renders its own shell
and got `min-w-0`:

```
page.tsx:83               <div className="flex min-w-0 flex-1 flex-col">   ← fixed
ConsolePageShell.tsx:69   <div className="flex flex-1 flex-col">           ← NOT fixed
```

**47 console pages use `ConsolePageShell`.** Every module except Overview still scrolls sideways on
a phone. This is a one-class fix already proven on Overview, and it is exactly the "later module
exposes a cross-module defect" case — flagged here, **not applied**, because Phase A is audit-only.

---

## 7. Summary of Phase A

**Correct and worth keeping:** health derivation through the single observation pass; expiry applied
at render; honest reasons on all three Unknowns; provenance attached to every state; no fabricated
health; no dead links; zero fake mutations.

**Defects found — 9 hard-coded/duplication findings, 3 of them cross-module:**

| | Finding | Scope |
|---|---|---|
| 1 | Third status vocabulary — "Operational" vs Overview's "Healthy" on 6 products | cross-module |
| 2 | Second route authority (`ROUTE_FOR`), diverging on 4 of 10 — MigraPanel opens the **customer portal** | cross-module |
| 3 | `ConsolePageShell` missing `min-w-0` → horizontal overflow on **47 pages** | cross-module |
| 4 | "10 products under unified control" — capability claim, zero controls | page |
| 5 | `Avg Activity 29.2%` — mean of incommensurable denominators | page |
| 6 | Per-tile activity bar on those same denominators | page |
| 7 | `usagePct: 0` hard-coded for AnnouPale/Pale → renders as measured idleness | page |
| 8 | Product list/identity/logos/accents are literals; no owner or business unit modelled | registry |
| 9 | Provenance truncated to unreadability | page |

**Structural conclusion:** the page flattens PRODUCT / SERVICE INSTANCE / DEPLOYMENT / HOST into one
tile, and **no product Control API or capabilities endpoint exists anywhere in the console**. Until
those are separated and a backend can be asked what it supports, no capability-driven control can be
built on this page — which is precisely why Phase A came before any control work.

---

## 8. PHASE B COMPLETE — and a correction to section 1 of this audit

All four steps done in the ordered sequence. Verified 16/16 in a browser against rendered DOM,
plus tsc 0 and build 0.

| Step | Done |
|---|---|
| 1. Vocabulary authority | `STATUS_DOT`/`STATUS_BADGE` deleted; `components/HealthState.tsx` gains `STATE_BADGE` + `HealthPill` and owns the word, dot and colour. "Operational" appears nowhere on the page; header counts use the canonical word too. |
| 2. Route authority | `ROUTE_FOR` deleted. The registry owns href **and** label. Verified live that every shared product now opens the **same destination** from Overview and Ecosystem. |
| 3. False claims removed | subtitle no longer claims control; `Avg Activity` gone and **not** replaced by another synthetic score; `usagePct: number` → `activity: {pct, describes} \| null`; gauge bar removed; provenance moved to its own line and is readable. |
| 4. Four-level read model | `lib/fleet/product-topology.ts` composes PRODUCT / SERVICE INSTANCE / DEPLOYMENT / HOST from the authorities that already own them. |

### 8.1 The host is derived, not declared

`nodeByAddress()` resolves a service endpoint's address against the reconciled estate, and the
answer carries the **provenance of the address that matched**. A product-to-host table would have
been a fourth place asserting estate identity and would have rotted silently the next time an
address moved.

Rendered per tile, live:

```
Hosting      1 service · the edge node (VM 102)
MigraPanel   1 service · migrapanel-core (VM 107)
Voice        1 service · app-core (VM 110)
Email        1 service · the edge node (VM 102)
Intake       1 service · app-core (VM 110)
Marketing    1 service · app-core (VM 110)
MigraTeck    1 service · host unresolved — colocated with the console; the console has
                         no source for its own node identity
Automation   1 service · host unresolved — no probe target, so no host to resolve
AnnouPale    no service instance is declared for this product yet
Pale         no service instance is declared for this product yet
```

And the correlation the flat grid structurally could not express:

```
Shared hosts
  <edge node>   vm 102 · ACTIVE · production   carries Hosting, Email
                                               matched on its LAN address (discovered)
  app-core      vm 110 · ACTIVE · production   carries Voice, Intake, Marketing
                                               matched on its LAN address (unverified)
```

### 8.2 🚨 Correction to section 1 of this audit

The host table in section 1 was written by hand from my reading of the probe list, and **it was
wrong about Email**. I put Email on mail-core (VM 108) because that is where mail lives. The probe
target is the **edge** on port 3010 (`/api/webmail/health`), so Email's probed *service instance*
runs on the edge node (VM 102), not mail-core.

The derivation caught my own error, which is the point of deriving it: a hand-written map encodes
what someone believed, and nothing checks it. Section 1's table should be read as superseded by
the rendered topology above.

Two further honest results worth keeping:
- **app-core's address matched on `unverified` provenance.** The topology says so rather than
  presenting the identification as certain.
- **The console cannot identify its own node.** `127.0.0.1` means "colocated with the console", and
  there is no self-identity source, so MigraTeck's host is `unresolved` with that reason instead of
  a guess at app-core.

### 8.3 Still not done, deliberately

Deployment is known **only** for the console itself, resolved from its own release directory and
`.next/BUILD_ID`. Every other product reports `this product does not report a deployment to the
console` — which is exactly the gap a product Control API would close, and none exists yet. No
capability or control work was done; that remains gated on the Control API contract.

⚠ Minor, pre-existing, not introduced here: run outside a release directory (a dev checkout),
`getReleaseInfo()`'s fallback yields a misleading release name — the local run shows
`release MigraTeck`. In production it resolves correctly (`20260910-overview-launchpad`).
