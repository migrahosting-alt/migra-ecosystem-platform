import { panelQuery, isPanelDbConfigured } from "./db";
import type { SystemMapNodes } from "../components/SystemMap";

export const loadSystemMapNodes = async (): Promise<SystemMapNodes> => {
  if (!isPanelDbConfigured()) {
    return {
      clients: { active: 0 },
      domains: { total: 0 },
      hosting: { active: 0 },
      email: { mailboxes: 0 },
      voice: { lines: 0 },
      intake: { forms: 0 },
      automation: { runs: 0 },
      marketing: { campaigns: 0 },
      billing: { mrrUsd: 0 },
    };
  }

  const [
    clients,
    domains,
    hosting,
    mailboxes,
    voice,
    intake,
    automation,
    marketing,
    mrr,
  ] = await Promise.all([
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM tenants WHERE COALESCE(status,'active') != 'churned'`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM domains`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM websites WHERE status = 'active'`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM mailboxes WHERE COALESCE(status, 'active') = 'active'`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM business_phone_numbers`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM builder_form_bindings`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM job_runs WHERE "startedAt" >= date_trunc('month', NOW())`),
    panelQuery<{ count: string }>(`SELECT COUNT(*)::int AS count FROM gbp_provision_requests WHERE status IN ('active','running','published')`),
    panelQuery<{ mrr: string }>(`SELECT COALESCE(SUM(COALESCE(renewal_rate, original_rate, 0))::numeric, 0)::text AS mrr FROM subscriptions WHERE status IN ('active','trialing')`),
  ]);

  const n = (rows: ReadonlyArray<{ count?: string; mrr?: string }>, k: "count" | "mrr") => {
    const r = rows[0];
    if (!r) return 0;
    const v = k === "count" ? r.count : r.mrr;
    return v == null ? 0 : Number(v);
  };

  return {
    clients: { active: n(clients, "count") },
    domains: { total: n(domains, "count") },
    hosting: { active: n(hosting, "count") },
    email: { mailboxes: n(mailboxes, "count") },
    voice: { lines: n(voice, "count") },
    intake: { forms: n(intake, "count") },
    automation: { runs: n(automation, "count") },
    marketing: { campaigns: n(marketing, "count") },
    billing: { mrrUsd: n(mrr, "mrr") },
  };
};
