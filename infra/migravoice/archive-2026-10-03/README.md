# MigraVoice retired surfaces — archived 2026-10-03

Captured from production **before retirement**, so the decision stays reversible
(Charter IV §11: production source must exist in Git).

Authorised by Bonex 2026-10-03: keep `migravoice.com` and `call.migrahosting.com`;
retire the surfaces below. See memory `project_migravoice_consolidation`.

| Directory | Was served at | Why retired |
|---|---|---|
| `migravoice-portal/` | `https://migravoice.com/portal/` + `/portal.html` | duplicate admin/client login; folds into the Control Center Voice module (Charter I §1) |
| `voice-admin/` | `https://voice.migrahosting.com/` | 🚨 full admin nav rendered with **no login**; `/api/voice/admin/users` returned 500 (handler ran unauthenticated), not 401. Hostname had no owner or purpose (Charter II §1) |

Verified against live at capture time:
- `migravoice-portal/index.html` sha256[0:16] `68c5ad77ff0b3822` (723 561 B, single-file app)
- `voice-admin/assets/index-uktia2Fl.js` sha256[0:16] `c610159020dc8d84` (202 068 B)

The backend behind `voice.migrahosting.com` (`migravoice-voice-backend`) is **not** on voip-core
(100.111.4.85) or app-core (100.68.175.27) — it was not located and is not archived here.
