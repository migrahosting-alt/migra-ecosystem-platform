# MigraMail (console Mail module) — regression & browser verification checklist

Repeatable checklist for verifying the MigraMail shared inbox inside MigraPanel
after any deploy. Backend enforcement is authoritative; the UI only gates
affordances by the per‑mailbox capabilities the backend returns.

## Setup
- Console: `https://console.migrateck.com/console/mail` (Super Admin login).
- A limited/support staff user with a grant on ONE mailbox (view + reply only).
- A throwaway test mailbox is recommended for mutating tests; clean up after.

## Super Admin flow
- [ ] `/console/mail` loads; all authorized mailboxes listed.
- [ ] Open a mailbox → message list loads with status/assignee/tag chips.
- [ ] Open a message → header (avatar, from, to, date, mailbox, chips), body renders.
- [ ] Reader: simple/business email renders **inline** (dark theme); newsletter renders as the **contained preview card** (Fit default); plain‑text renders natively.
- [ ] Reply sends; Forward sends (with/without "Include attachments").
- [ ] Status open/pending/closed; Assign / Assign‑to‑me / Unassign; add/remove tag; add/delete internal note.
- [ ] Filters: search (sender/subject), status, assigned (me/unassigned), tag, unread, 📎 has‑attachment; pagination if many results.
- [ ] `/console/mail/settings` loads; register mailbox / staff / grants.

## Limited support user flow
- [ ] Sees ONLY assigned mailbox(es).
- [ ] Can read messages + workflow + add notes (view).
- [ ] Reply works only if granted `reply`.
- [ ] Cannot change status/tags/assign without `assign` (controls hidden; direct API → 403).
- [ ] Cannot forward without `send` (→ 403); cannot include attachments without `view_attachments` (→ 403).
- [ ] Attachments visible/downloadable only with `view_attachments`.

## Unauthorized direct API (expect 403 / 401)
- [ ] No session → 401 on `/console/mail/api/mm/*`.
- [ ] Non‑staff identity → 403.
- [ ] `GET /…/mailboxes/<ungranted id>/messages` → 403.
- [ ] `POST /…/status|tags|assign` without `assign` → 403.
- [ ] `POST /…/forward` without `send` → 403; with `includeAttachments` but no `view_attachments` → 403.
- [ ] `GET /…/mailboxes/<id>/assignable` without `assign` → 403.

## Rendering
- [ ] Newsletter (LinkedIn‑style): centered preview card, Fit default, Full‑width toggle, no inner scrollbar, remote images blocked → "Show images".
- [ ] Simple HTML: inline dark reader, links open in new tab, no iframe.
- [ ] Plain text: wrapped, readable.
- [ ] Long email: page scrolls, iframe auto‑sizes (ResizeObserver).

## Customer context
- [ ] Sender matching a customer → name/status + counts + "Open profile".
- [ ] Unmatched sender → "No matching customer" (no incorrect data).

## Cross‑surface sanity
- [ ] Standalone MigraMail (`https://mail.migrahosting.com`) still loads/logs in.
- [ ] Console routes outside Mail (`/console/clients`, `/console/annoupale`, `/console/email`) still load.

## Audit (in the MigraMail `mail` DB `audit_log`)
- [ ] Rows for: mailbox open, message view, send, reply, forward (with attachmentsIncluded/Omitted), attachment view, assign/unassign, status change, tag add/remove, note add/delete, access denied, grant create/update/remove.
- [ ] No email body, note body, secrets, tokens, or raw attachments in audit detail.

## Automated coverage
- Backend unit: `pnpm --filter ... test:panel` (workflow helpers).
- Backend E2E harness (local, temp DB + mail‑core): capability matrix, search,
  has‑attachment, pagination, attachment‑forward gating, assignable — 18 checks.
