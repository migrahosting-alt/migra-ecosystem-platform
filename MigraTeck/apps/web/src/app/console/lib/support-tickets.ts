import { panelQuery, isPanelDbConfigured } from "./db";

/**
 * The one canonical open-ticket count.
 *
 * WHY THIS FILE EXISTS
 *
 * The Universe page read `lib/support.ts`, which counted `chat_tickets`. That
 * table is a retired generation: 1 row, closed, last written 2026-02-09. The
 * live support system writes `chat_conversations` (154 rows). So the console
 * rendered "0 open tickets" from a real COUNT of dead data — no error, no null,
 * just a confident false statement. Nothing in the code path looked wrong.
 *
 * WHY IT IS NOT SIMPLY "COUNT chat_conversations"
 *
 * Swapping the table name alone would have reported 122, which is just as
 * untrue in the other direction. Of those 122 "open" rows:
 *   - 117 are mode='ai'          — website AI chat sessions, not staff tickets
 *   - 109 have exactly 1 message — a visitor said one thing and left
 *   - 121 are stale beyond 30 days
 * They are abandoned chat sessions nobody ever closed.
 *
 * THE CANONICAL DEFINITION
 *
 * Taken from the staff-facing support surface, not invented here.
 * `lib/modules/support.ts` — which backs /console/support — defines a ticket as
 * a *human-mode* conversation (`WHERE ct.mode = 'human'`, line ~115) and open as
 * `status NOT IN ('closed','resolved')` (line ~132). This module uses exactly
 * that predicate so the Universe tile, the messages badge and the support page
 * can never disagree. There is no CHECK constraint on `status`, so the observed
 * vocabulary is: open, closed, resolved, waiting_on_customer. `waiting_on_customer`
 * counts as open — it is awaiting the customer, not finished.
 *
 * If the support page's definition changes, change it here too, or delete this
 * module and import theirs. Two definitions is how this defect happened.
 */

export const OPEN_TICKET_PREDICATE = `mode = 'human' AND status NOT IN ('closed','resolved')`;

export const OPEN_TICKET_SOURCE =
  "panel DB · chat_conversations where mode='human' and status not in ('closed','resolved')";

export interface OpenTicketCount {
  /** null means "not measured" — render an em dash, never 0. */
  count: number | null;
  /** Why the count is null, when it is. */
  reason?: string;
  source: string;
}

export const loadOpenTicketCount = async (): Promise<OpenTicketCount> => {
  if (!isPanelDbConfigured()) {
    return { count: null, reason: "panel database not configured", source: OPEN_TICKET_SOURCE };
  }

  try {
    const rows = await panelQuery<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM chat_conversations WHERE ${OPEN_TICKET_PREDICATE}`,
    );
    const raw = rows[0]?.count;
    if (raw == null) {
      // No row back from an aggregate means the query did not run as expected.
      // That is a measurement failure, not a measurement of zero.
      return { count: null, reason: "support query returned no result", source: OPEN_TICKET_SOURCE };
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { count: null, reason: "support count was not numeric", source: OPEN_TICKET_SOURCE };
    }
    return { count: n, source: OPEN_TICKET_SOURCE };
  } catch {
    return { count: null, reason: "support query failed", source: OPEN_TICKET_SOURCE };
  }
};
