# MigraTeck & MigraHosting Governance Charter

**v1.2 — adopted 2026-09-12, amended 2026-09-13. In force.**
Published reference: https://claude.ai/code/artifact/c747d8fc-60ce-465e-ae14-bda507d08a4c

This is the standard every architecture decision is checked against. It supersedes
institutional memory.

## The structure — one company, two operating brands

**MigraTeck LLC is the legal entity.** It operates both brands below. They are operating
identities and ownership boundaries, not separate companies — which is what makes contracts,
billing, legal attribution, security ownership and audit answerable to one party.

**MigraTeck — platform and product identity.** Software products and
customer-facing applications, identity architecture, the control plane, governance,
product standards, engineering systems, entitlement definition.

**MigraHosting — hosting and infrastructure services brand.** Domains, DNS, certificates, mail
hosting, hosting plans, server resource, deployment infrastructure, customer hosting
operations, and the commercial hosting layer products consume.

## The instrument — four questions for every feature

1. **Who owns the product capability?**
2. **Who operates the infrastructure behind it?**
3. **Who bills the customer for it?** (One answer only. Shared billing is a defect.)
4. **Which identity does the customer see?** (From trusted client registration and
   canonical server-side host mapping — never from request-controlled values. See III §1.)

If any answer is unclear, the design is not finished.

| Capability | Product owner | Operator | Customer sees |
|---|---|---|---|
| MigraCMS editor | MigraTeck | MigraTeck | MigraCMS |
| MigraCMS custom domain | MigraTeck | MigraHosting | MigraCMS |
| MigraAuth identity engine | MigraTeck | MigraTeck | nothing — infrastructure |
| `auth.migrahosting.com` | MigraTeck | MigraHosting | MigraHosting |
| DNS provisioning | MigraHosting | MigraHosting | MigraHosting |
| Control Center governance | MigraTeck | MigraTeck | MigraTeck |
| Hosting invoice | MigraHosting | MigraHosting | MigraHosting |

## Article I — Product ownership

- **I §1** One capability, one authority. A question answered in two places drifts apart.
- **I §2** If the UI says a feature exists, it works end to end. No decorative controls,
  no fake integrations, no button that performs less than it claims.
- **I §3** A shown limit is an enforced limit; a shown price is a real price. No
  placeholder "contact sales" where an ordinary price belongs.
- **I §4** Unknown state is displayed as unknown. A dash is honest; a fabricated
  "Available" is not.
- **I §5** Free-to-paid moves through real entitlement and billing transitions, never a
  manual workaround that leaves the record inconsistent.

## Article II — Infrastructure ownership

- **II §1** Every service, repository, VM, domain, release, database, queue, credential
  and public hostname has an explicit **owner, purpose, environment, dependency chain and
  source-of-truth record**.
- **II §2** Products may bundle hosting services; the ownership and billing boundary stays
  explicit.
- **II §3** Canonical state lives in the managing system, not the file it renders. (Mail
  capability is decided in MigraPanel and rendered to Postfix maps — never hand-edited.)
- **II §4** Infrastructure claims are proven through the real execution path. A control is
  not real because a package is installed, a service is active, or a timer exists.

## Article III — Identity & branding

- **III §1** Brand identity derives from a **trusted product/client registration and a
  canonical server-side host mapping** — never directly from request-controlled values such
  as an unvalidated Host header, return URL or redirect URI. (In practice: the OAuth
  client's registered branding, resolved server-side, with first-party host defaults as the
  fallback.)
- **III §2** Each customer-facing product gets a first-party recovery hostname; the issuer
  stays shared and invisible. A branded message whose credential link lands on a different
  registrable domain is the shape of a phishing mail.
- **III §3** `migrateck.com` is the **corporate and platform domain** for MigraTeck and is
  public-facing. It must not appear inside a customer journey whose visible product identity
  is MigraHosting, MigraCMS, AnnouPale or another first-party product, unless the transition
  is explicitly corporate/legal and intentional. MigraTeck LLC may appear as legal
  attribution where appropriate.
- **III §4** Privileged actions trace to a named human principal. Shared `admin@` addresses
  receive notifications; they are not routine privileged logins.
- **III §5** MFA mandatory for privileged roles; break-glass ownership held separately.
  Never fewer than one verified working owner; final state at least two MFA-protected owners.
- **III §6** No silent privilege fallback. Unknown context falls back deliberately and
  visibly, or refuses.

## Article IV — Release governance

- **IV §1** Git is the canonical source for application code. No production service may sit
  indefinitely ahead of, or sideways from, the repository.
- **IV §2** Production maps to an immutable release and an exact commit. The active release
  must answer at any moment: *which source commit and artifact is running?*
- **IV §3** **No dirty-tree deployment.** A hard release gate, not a warning.
- **IV §4** No source editing or building inside an active release. Emergency fixes create
  a new immutable release; they never mutate `current`.
- **IV §5** Every deployment carries provenance: commit SHA, artifact digest, lockfile
  hash, build ID, SBOM, migration version, gates passed. Promotion verifies before deploy.
- **IV §6** Rollback is repointing to a prior immutable release.
- **IV §7** Drift is a first-class signal. Deployed digest ≠ manifest shows **DRIFTED**,
  never green.
- **IV §8** **Reconciliation must land in the canonical build line.** Reconciliation is
  complete only when the intended production state is represented in the declared canonical
  branch future releases build from. If the source reconciliation history is unrelated to
  canonical history, preserve it by immutable tag and perform a reviewed content graft
  rather than manufacturing ancestry with an unrelated-history merge. A reconciliation
  commit that terminates in a side branch is still operational drift.
- **IV §9** **A reconciliation release must be behaviour-neutral** unless an explicit
  product-change approval is attached. Source may contain unreleased capability; the
  release artifact must not expose it implicitly. Route parity is asserted in BOTH
  directions — an added route broadens the live surface, a removed one breaks it.
- **IV §10** **Canonical branch isolation.** The canonical production branch is not a
  shared scratch branch. Feature and experimental work occurs on isolated
  branches/worktrees and reaches canonical only through controlled integration. **A dirty
  active checkout of canonical blocks release integration.** The canonical tip is verified
  immediately before and immediately after integration; if it moved, restart. Never move
  the pointer beneath a live checkout — `update-ref` is not a shortcut past this.
- **IV §11** **Source required by production that Git ignores is a release-blocking
  defect.** Verified by sweep against the committed tree, with an explicit, minimal,
  versioned allowlist.
- **IV §12** **Parity is measured against the committed tree that will be released**, never
  against the mutable filesystem. Only the commit is released; filesystem parity is not
  commit parity.

## Article V — Security & operations

- **V §1** Tenant isolation is structural, not conventional. Every read/write path scoped
  to identity, organization and role by construction.
- **V §2** An authenticated agent is still an untrusted evidence source. Holding a
  credential proves identity; it does not widen scope.
- **V §3** Degraded and unknown states are reported honestly.
- **V §4** Security defects may be promoted independently of feature releases.
- **V §5** Sensitive edge/infrastructure changes stay guarded, scoped and auditable.
  Exceptions are written down before they are applied, bounded to one asset, removed once
  verified.
- **V §6** Automated tests mean "ready for validation". The owner's real-system test is the
  acceptance gate. Nothing is done because CI passed.

## Ledger

**Adopted:** 12 September 2026 · **Ledger status as of:** 13 September 2026

| Ref | Item | State |
|---|---|---|
| IV §1–3 | Production does not map to a commit (web + auth services) | **NON-COMPLIANT** |
| III §5 | MFA enrolled on zero principals; sole platform owner is password-only | **NON-COMPLIANT** |
| III §4 | Organization ownership still held by a retired identity | IN PROGRESS |
| III §2–3 | First-party recovery hostname live, reset mail single-brand | COMPLIANT |
| I §2 | Gmail inbox placement unverified | AWAITING VALIDATION |

A charter that reports itself compliant on the day it is adopted is a charter nobody
measured. Those five rows are the work.

## Change control

Amendments require an explicit owner decision, a date, a rationale, and preservation of the
previous version. The machine-readable ledger lives at `docs/governance/governance-status.json`
and is the source the Control Center reads.

| Version | Date | Change | Rationale |
|---|---|---|---|
| 1.0 | 2026-09-12 | Adopted | Initial doctrine |
| 1.1 | 2026-09-12 | "Two companies" → one company, two operating brands; III §1 and III §3 narrowed | v1.0 misstated the legal structure (MigraHosting is a brand of MigraTeck LLC, not a company) and declared the public corporate domain "internal", contradicting the live site |
| 1.2 | 2026-09-13 | Added IV §8–§12 | Each evidenced by a failure in the web reconciliation: an orphaned prior reconciliation (§8); a candidate that would have added 13 routes and removed 1 (§9); four stale candidates from canonical doubling as a scratch branch (§10); a `backups/` ignore rule eating two live routes (§11); a parity proof that passed against a worktree while the commit was short two files (§12). Isolation is §10 not §9 because `release-withhold.json` already cites IV §9 |

## Deployment freeze (in force)

`20260912-web-001` is the **last exception-based overlay before reconciliation**. Until
Article IV is satisfied for a service, a request for a normal feature deployment is answered:

> **Blocked by Article IV §1–3.** Security emergency fixes may proceed under Article V §4
> using an immutable emergency-release procedure.

See [[project-migrateck-release-provenance]], [[project-migrateck-admin-identity-standardization]],
[[project-migrahosting-reset-email-spam]] in agent memory for the evidence behind each row.
