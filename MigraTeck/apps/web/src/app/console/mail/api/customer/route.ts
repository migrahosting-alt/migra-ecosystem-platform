import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "../../../lib/api-helpers";
import { resolveStaffIdentity } from "../../../lib/mail-identity";
import { loadClientByEmail } from "../../../lib/modules/clients";

/**
 * Console-side sender → customer context for the Mail module. Reuses the Clients
 * module's existing migrapanel access (no cross-DB risk). Gated on a valid staff
 * identity (same gate as mail access). Returns a SAFE summary + a profile link;
 * never raw billing internals.
 */

export const dynamic = "force-dynamic";

const OPEN_INVOICE = new Set(["open", "unpaid", "overdue", "past_due", "pending"]);
const ACTIVE_SUB = new Set(["active", "trialing"]);

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const identity = await resolveStaffIdentity(auth.session.email);
  if (!identity) {
    return NextResponse.json({ error: "no_mail_access" }, { status: 403 });
  }

  const email = (req.nextUrl.searchParams.get("email") || "").trim();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ customer: null });
  }

  const c = await loadClientByEmail(email);
  if (!c) {
    return NextResponse.json({ customer: null });
  }

  return NextResponse.json({
    customer: {
      id: c.id,
      name: c.name,
      status: c.status,
      activeServices: c.subscriptions.filter((s) => ACTIVE_SUB.has(s.status)).length,
      openInvoices: c.invoices.filter((i) => OPEN_INVOICE.has(i.status)).length,
      domains: c.domains.length,
      websites: c.websites.length,
      mailboxes: c.mailboxes.length,
      profileHref: `/console/clients/${c.id}`,
    },
  });
}
