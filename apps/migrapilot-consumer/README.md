# MigraPilot — consumer application

> **Status: Step 0 complete — trust boundary established, features not yet wired.**
>
> The app is now a **Next.js App Router** application with a real server-side trust
> boundary: authenticated server → Brain, never browser → Brain. The gateway, tenancy
> derivation, and boundary tests are production code.
>
> **The screens are still driven by the demo layer.** Chat replies, file analysis,
> research citations, project data, and coding-run progress remain locally fabricated
> (`src/data/mock.ts`, `src/state/demoResponder.ts`) and are not wired to the seams yet.
> It must not be presented, deployed, or demoed as functional product capability.
>
> Authentication is a **fail-closed port**: no implementation is installed, so the app
> serves no principal at all rather than a fabricated one. See
> [src/server/auth/README.md](src/server/auth/README.md).

## Architecture

```
Browser ──► Next.js authenticated server ──► Brain
                     │
                     ├─ src/server/auth/       MigraAuth session (port; fail-closed)
                     ├─ src/server/tenancy/    identity → X-Owner-Scope (fail-closed)
                     └─ src/server/brain/      gateway: closed operation set

NEVER  Browser ──► Brain
NEVER  Browser ──► X-Owner-Scope ──► Brain
```

- **Scope is server-derived.** `owner = user:<oidc-sub>`, `workspace = org:<id>` or
  `personal`. No parameter exists through which a caller could supply one.
- **No arbitrary proxying.** Callers pass a `BrainOperation` from a closed union, never a
  path; ids are pattern-validated.
- **Outbound headers are constructed, not forwarded.** Cookies and `authorization` never
  leave.
- **Governed coding is observation-only** — the browser has no `workspaceRoot`, so no
  start/approve/cancel operation exists. See [src/server/brain/REUSE.md](src/server/brain/REUSE.md).

## Building on this machine

⚠️ **`P:` is exFAT and cannot build Next.js.** exFAT has no symlink/junction support, which
both Turbopack and webpack require. `npm run typecheck` and `npm run test` work here;
`next build` does not. Develop from an NTFS path or a Linux filesystem.

## What is simulated

Everything in this table is fake and must be replaced or truthfully gated before this
becomes a consumer application.

| Area | Today | Source |
| --- | --- | --- |
| Identity | Hard-coded sample user; no auth, no session, no verified principal | [`src/data/mock.ts`](src/data/mock.ts) |
| Chat replies | Keyword-routed canned answers on a fixed delay | [`src/state/demoResponder.ts`](src/state/demoResponder.ts) |
| Conversation persistence | In memory only — everything is lost on reload | [`src/state/ChatProvider.tsx`](src/state/ChatProvider.tsx) |
| Conversation history | Static seed data, not durable storage | [`src/data/mock.ts`](src/data/mock.ts) |
| File processing | Uploads are read for name and size only; "detected topics", key points, and the AI summary are hard-coded | [`src/pages/FilesPage.tsx`](src/pages/FilesPage.tsx) |
| Research / citations | Fabricated answer with fabricated sources — **no research was performed** | [`src/data/mock.ts`](src/data/mock.ts) |
| Projects | Invented projects, members, and activity | [`src/data/mock.ts`](src/data/mock.ts) |
| Assistants | Invented; no persistence model | [`src/data/mock.ts`](src/data/mock.ts) |
| Settings | Toggles change local state only; nothing persists | [`src/pages/SettingsPage.tsx`](src/pages/SettingsPage.tsx) |
| Governed coding run | Scope approval is a local dialog; run "progress" is a `setInterval` timer, not durable execution | [`src/pages/RunProgressPage.tsx`](src/pages/RunProgressPage.tsx), [`src/features/governance/ScopeApprovalModal.tsx`](src/features/governance/ScopeApprovalModal.tsx) |
| Run report | Static results for a run that never ran | [`src/data/mock.ts`](src/data/mock.ts) |

**Nothing is real.** The demo layer is deliberately confined to `src/data/` and `src/state/`
so it can be removed wholesale.

## Where this is going

```text
Today       MigraPilot consumer UI prototype ......... built
Next        MigraPilot consumer application .......... wire real services
Production  chat.migrateck.com ....................... only after auth + tenant
                                                       isolation + real backend acceptance
```

**Phase 1 — real foundation** (backends already exist):

- **Auth** — MigraAuth OIDC/PKCE, real authenticated user, verified principal,
  logout/session handling. No production exposure until #147 clears.
- **Chat** — real Brain chat/answer route, streaming where supported, durable
  conversations and messages, real history, reload persistence, truthful errors and
  cancellation.
- **Governed coding** — real capability endpoint, start, scope approval, durable run
  polling, cancellation, and completion report. No clocks pretending a run is progressing.

**Phase 2 — remove unsupported simulations.** Files, Explore/Research, Projects,
Assistants, and Settings keep their visual implementation but must be truthfully gated
(disabled or shown as unavailable) until a real service backs them. No fabricated
citations, projects, assistants, or analysis results ship.

**Open architecture decision:** whether this stays an independent repository or moves into
the canonical MigraTeck repository as `apps/migrapilot-consumer`. Brain contracts, auth
packages, shared types, CI, and deployment infrastructure already live there. **Do not push
this anywhere until that is decided.**

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle into dist/
npm run typecheck  # types only
npm run preview    # serve the production build
```

## Screens

Built from the ten design drafts in [`mockups/`](mockups/), which remain the design source
of truth.

| Route | Screen | Mockup |
| --- | --- | --- |
| `/` | Welcome — hero, task suggestions, composer | 1 |
| `/chat/:id` | Conversation with sources and conversation tools | 2 |
| `/chat/migration-plan-review` | Multimodal review — image + voice note, media library rail | 9 |
| `/files` | Upload and analyse — dropzone, insights, detected topics | 3 |
| *(modal)* | Proposed Coding Change — scope approval gate | 4 |
| `/runs/active` | Coding run in progress — steps and activity | 5 |
| `/runs/:id` | Run report — stats, fixes, changed files | 6 |
| `/explore` | Research — answer with citations and sources | 7 |
| `/projects` | Projects — cards, progress, workspace overview | 8 |
| `/history` | History — grouped chats, saved assistants, coding runs | 10 |
| `/assistants` | Saved assistants (nav destination, extends mockup 10) | — |
| `/settings` | Profile, assistant behaviour, governance (nav destination) | — |

To walk the governed-change flow, ask a conversation for a code change (for example
*"Refactor the migration service and add retry logic"*); the reply carries a **Review
scope** action that opens the approval dialog and then the run screens.

## Architecture

```
src/
  components/
    brand/      logo mark and wordmark (inline SVG)
    layout/     AppShell, Sidebar, TopBar, Workspace (main + rail + secondary column)
    ui/         Button, Card, Badge, Avatar, Modal, Tabs, Progress, FileTypeIcon…
    chat/       Composer, Message renderer, RichText, diagram/waveform previews
    rail/       shared right-rail panels
  features/
    governance/ ScopeApprovalModal
  data/         DEMO ONLY — types + the mock content driving every screen
  state/        DEMO ONLY — ChatProvider (in-memory store) and demoResponder
  pages/        one file per screen
```

Design tokens (brand ramp, canvas/rail surfaces, hairlines, radii, shadows, motion) are
declared once in [`src/index.css`](src/index.css) under Tailwind's `@theme`.

Every screen composes the same `<Workspace>`: an optional secondary column, a scrolling
main region, and an optional right rail. The rail hides below 1280px; the sidebar becomes a
drawer below 1024px.

`ChatProvider` is the only component that knows where replies come from, which is the
intended seam for a real Brain adapter.
