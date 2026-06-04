import { NextRequest, NextResponse } from "next/server";
import { panelQuery, isPanelDbConfigured } from "../../lib/db";

type ResultType = "client" | "domain" | "ticket" | "module";

type SearchResult = {
  id: string;
  type: ResultType;
  label: string;
  sublabel?: string;
  href: string;
};

const MODULES: SearchResult[] = [
  { id: "billing", type: "module", label: "Billing", sublabel: "Invoices & payments", href: "/console/billing" },
  { id: "clients", type: "module", label: "Clients", sublabel: "Tenant accounts", href: "/console/clients" },
  { id: "hosting", type: "module", label: "Hosting", sublabel: "Sites & deployments", href: "/console/hosting" },
  { id: "domains", type: "module", label: "Domains", sublabel: "DNS & registrar", href: "/console/domains" },
  { id: "email", type: "module", label: "Email", sublabel: "Mailboxes & campaigns", href: "/console/email" },
  { id: "voice", type: "module", label: "Voice", sublabel: "Calls & IVR", href: "/console/voice" },
  { id: "intake", type: "module", label: "Intake", sublabel: "Lead forms & CRM", href: "/console/intake" },
  { id: "marketing", type: "module", label: "Marketing", sublabel: "SEO & campaigns", href: "/console/marketing" },
  { id: "automation", type: "module", label: "Automation", sublabel: "Jobs & webhooks", href: "/console/automation" },
  { id: "analytics", type: "module", label: "Analytics", sublabel: "Events & conversions", href: "/console/analytics" },
  { id: "security", type: "module", label: "Security", sublabel: "Compliance & access", href: "/console/security" },
  { id: "support", type: "module", label: "Support", sublabel: "Tickets & SLA", href: "/console/support" },
  { id: "team", type: "module", label: "Team", sublabel: "Staff & roles", href: "/console/team" },
  { id: "settings", type: "module", label: "Settings", sublabel: "Platform config", href: "/console/settings" },
];

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json(MODULES.slice(0, 8));
  }

  const lower = q.toLowerCase();
  const results: SearchResult[] = MODULES.filter(
    (m) =>
      m.label.toLowerCase().includes(lower) ||
      (m.sublabel ?? "").toLowerCase().includes(lower),
  );

  if (isPanelDbConfigured()) {
    const [clients, domains, tickets] = await Promise.all([
      panelQuery<{ id: string; name: string; domain: string | null }>(
        `SELECT t.id,
                COALESCE(t.name, t.company_name, t.slug, t.id) AS name,
                COALESCE(
                  t.domain,
                  (SELECT d.domain FROM domains d WHERE d."tenantId" = t.id ORDER BY d."createdAt" ASC LIMIT 1)
                ) AS domain
           FROM tenants t
          WHERE (
                  LOWER(COALESCE(t.name, t.company_name, t.slug, '')) LIKE $1
                  OR LOWER(COALESCE(t.domain, '')) LIKE $1
                  OR LOWER(COALESCE(t.billing_email, '')) LIKE $1
                )
            AND COALESCE(t.is_active, TRUE) = TRUE
          ORDER BY t.createdat DESC NULLS LAST
          LIMIT 5`,
        [`%${lower}%`],
      ),
      panelQuery<{ id: string; domain: string; tenantname: string | null }>(
        `SELECT d.id, d.domain,
                (SELECT COALESCE(t.name, t.company_name, t.id)
                   FROM tenants t
                  WHERE t.id = d."tenantId"
                  LIMIT 1) AS tenantname
           FROM domains d
          WHERE LOWER(d.domain) LIKE $1
          ORDER BY d."createdAt" DESC NULLS LAST
          LIMIT 5`,
        [`%${lower}%`],
      ),
      panelQuery<{
        id: string;
        subject: string;
        priority: string | null;
      }>(
        `SELECT id,
                COALESCE(subject, 'Ticket #' || ticket_number::text, id::text) AS subject,
                LOWER(priority) AS priority
           FROM chat_tickets
          WHERE LOWER(COALESCE(subject, '')) LIKE $1
            AND status NOT IN ('closed','resolved')
          ORDER BY created_at DESC NULLS LAST
          LIMIT 3`,
        [`%${lower}%`],
      ),
    ]);

    for (const c of clients) {
      results.push({
        id: c.id,
        type: "client",
        label: c.name,
        ...(c.domain != null ? { sublabel: c.domain } : {}),
        href: `/console/clients/${c.id}`,
      });
    }
    for (const d of domains) {
      results.push({
        id: d.id,
        type: "domain",
        label: d.domain,
        ...(d.tenantname != null ? { sublabel: d.tenantname } : {}),
        href: `/console/domains`,
      });
    }
    for (const t of tickets) {
      results.push({
        id: t.id,
        type: "ticket",
        label: t.subject,
        ...(t.priority != null ? { sublabel: `Priority: ${t.priority}` } : {}),
        href: `/console/support`,
      });
    }
  }

  return NextResponse.json(results.slice(0, 15));
}
