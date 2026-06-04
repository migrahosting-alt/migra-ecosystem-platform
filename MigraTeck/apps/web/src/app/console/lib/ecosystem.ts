import { panelQuery, isPanelDbConfigured } from "./db";

/**
 * The 8 ecosystem product tiles shown in the Control Grid.
 *
 * Each tile shows a usage metric. The metric depends on the module:
 *  - MigraTeck Core (MT): % of platform.read sessions in last 30d vs cap
 *  - Hosting       (MH): % of provisioned hosting accounts vs subscribed slots
 *  - MigraPanel    (MP): % of panel API requests in last 7d vs trailing 30d avg
 *  - Voice         (MV): % of registered SIP endpoints currently active
 *  - Email         (MM): % of mailboxes in use vs subscribed mailbox quota
 *  - Intake        (MI): % of intake forms submitted in last 30d vs published forms
 *  - Marketing     (MK): % of active campaigns vs total campaigns this quarter
 *  - Automation    (AU): % successful job runs in last 7d
 */

export type ProductTile = {
  id: string;
  initials: string;
  name: string;
  subtitle: string;
  logoSrc: string;
  logoAlt: string;
  usagePct: number;
  status: "operational" | "degraded" | "down" | "unknown";
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
  accent: string; // tailwind gradient classes for the tile avatar
};

const PRODUCT_LOGOS: Record<string, { src: string; alt: string }> = {
  migrateck: { src: "/brands/products/migrateck.png", alt: "MigraTeck logo" },
  hosting: { src: "/brands/products/migrahosting.png", alt: "MigraHosting logo" },
  panel: { src: "/brands/products/migrapanel-official.png", alt: "MigraPanel logo" },
  voice: { src: "/brands/products/migravoice.png", alt: "MigraVoice logo" },
  email: { src: "/brands/products/migramail.png", alt: "MigraMail logo" },
  intake: { src: "/brands/products/migraintake.png", alt: "MigraIntake logo" },
  marketing: { src: "/brands/products/migramarketing.png", alt: "MigraMarketing logo" },
  automation: { src: "/brands/products/migrapilot.png", alt: "MigraPilot logo" },
};

const ACCENTS: Record<string, string> = {
  migrateck: "from-indigo-500 to-fuchsia-500",
  hosting: "from-sky-500 to-cyan-500",
  panel: "from-violet-500 to-purple-500",
  voice: "from-rose-500 to-orange-500",
  email: "from-emerald-500 to-teal-500",
  intake: "from-amber-500 to-yellow-500",
  marketing: "from-pink-500 to-rose-500",
  automation: "from-blue-500 to-indigo-500",
};

const fallback = (id: string, name: string, subtitle: string, initials: string, accent: string): ProductTile => ({
  id,
  initials,
  name,
  subtitle,
  logoSrc: PRODUCT_LOGOS[id]?.src ?? "/brands/products/migrateck.png",
  logoAlt: PRODUCT_LOGOS[id]?.alt ?? `${name} logo`,
  usagePct: 0,
  status: "unknown",
  primaryAction: { label: "Open", href: `https://${id}.migrahosting.com` },
  secondaryAction: { label: "Reports", href: `/console/${id}/reports` },
  accent,
});

export const loadEcosystem = async (): Promise<ProductTile[]> => {
  const tiles: ProductTile[] = [
    fallback("migrateck", "MigraTeck", "Core Platform", "MT", ACCENTS.migrateck!),
    fallback("hosting", "Hosting", "Web Hosting", "MH", ACCENTS.hosting!),
    fallback("panel", "MigraPanel", "Client Portal", "MP", ACCENTS.panel!),
    fallback("voice", "Voice", "VoIP System", "MV", ACCENTS.voice!),
    fallback("email", "Email", "Email Services", "MM", ACCENTS.email!),
    fallback("intake", "Intake", "Intake Forms", "MI", ACCENTS.intake!),
    fallback("marketing", "Marketing", "Marketing Suite", "MK", ACCENTS.marketing!),
    fallback("automation", "Automation", "Workflows", "AU", ACCENTS.automation!),
  ];

  if (!isPanelDbConfigured()) return tiles;

  const usage = await Promise.all([
    // MigraTeck Core: % of users who logged in within the last 7 days
    panelQuery<{ pct: string }>(
      `WITH a AS (
         SELECT COUNT(*) AS active FROM users
          WHERE last_login_at >= NOW() - INTERVAL '7 days'
       ),
       t AS (SELECT COUNT(*) AS total FROM users WHERE COALESCE(is_active, TRUE) = TRUE)
       SELECT CASE WHEN t.total = 0 THEN 0
                   ELSE LEAST(100, ROUND((a.active::numeric / t.total) * 100, 1)) END AS pct
         FROM a, t`,
    ),
    // Hosting: % of websites currently active
    panelQuery<{ pct: string }>(
      `WITH a AS (SELECT COUNT(*) AS active FROM websites WHERE status = 'active'),
            t AS (SELECT COUNT(*) AS total FROM websites)
       SELECT CASE WHEN t.total = 0 THEN 0
                   ELSE ROUND((a.active::numeric / t.total) * 100, 1) END AS pct
         FROM a, t`,
    ),
    // MigraPanel: audit_events last 24h vs trailing 7d daily avg
    panelQuery<{ pct: string }>(
      `SELECT CASE WHEN trailing = 0 THEN 0
                   ELSE LEAST(100, ROUND((recent::numeric / trailing) * 100, 1)) END AS pct
         FROM (
           SELECT
             (SELECT COUNT(*) FROM audit_events WHERE createdat >= NOW() - INTERVAL '1 day')::numeric AS recent,
             GREATEST(((SELECT COUNT(*) FROM audit_events WHERE createdat >= NOW() - INTERVAL '7 days') / 7.0), 1) AS trailing
         ) t`,
    ),
    // Voice: % of phone extensions that are enabled
    panelQuery<{ pct: string }>(
      `WITH a AS (SELECT COUNT(*) AS active FROM business_phone_extensions WHERE enabled = TRUE),
            t AS (SELECT COUNT(*) AS total  FROM business_phone_extensions)
       SELECT CASE WHEN t.total = 0 THEN 0
                   ELSE ROUND((a.active::numeric / t.total) * 100, 1) END AS pct
         FROM a, t`,
    ),
    // Email: % of mailboxes with active status
    panelQuery<{ pct: string }>(
      `WITH a AS (SELECT COUNT(*) AS active FROM mailboxes WHERE COALESCE(status, 'active') = 'active'),
            t AS (SELECT COUNT(*) AS total FROM mailboxes)
       SELECT CASE WHEN t.total = 0 THEN 0
                   ELSE ROUND((a.active::numeric / t.total) * 100, 1) END AS pct
         FROM a, t`,
    ),
    // Intake: growth_leads last 30d vs builder_form_bindings count
    panelQuery<{ pct: string }>(
      `WITH s AS (SELECT COUNT(*) AS submitted FROM growth_leads WHERE createdat >= NOW() - INTERVAL '30 days'),
            f AS (SELECT COUNT(*) AS forms FROM builder_form_bindings)
       SELECT CASE WHEN f.forms = 0 THEN 0
                   ELSE LEAST(100, ROUND((s.submitted::numeric / GREATEST(f.forms * 30, 1)) * 100, 1)) END AS pct
         FROM s, f`,
    ),
    // Marketing: published GBP posts this quarter vs total GBP posts this quarter
    panelQuery<{ pct: string }>(
      `WITH a AS (
         SELECT COUNT(*) AS active FROM gbp_posts
          WHERE status IN ('published','active')
            AND createdat >= date_trunc('quarter', NOW())
       ),
       t AS (
         SELECT COUNT(*) AS total FROM gbp_posts
          WHERE createdat >= date_trunc('quarter', NOW())
       )
       SELECT CASE WHEN t.total = 0 THEN 0
                   ELSE ROUND((a.active::numeric / t.total) * 100, 1) END AS pct
         FROM a, t`,
    ),
    // Automation: % successful job runs in last 7 days
    panelQuery<{ pct: string }>(
      `WITH r AS (
         SELECT
           COUNT(*) FILTER (WHERE status = 'succeeded')::numeric AS ok,
           COUNT(*)::numeric AS total
           FROM job_runs
          WHERE "startedAt" >= NOW() - INTERVAL '7 days'
       )
       SELECT CASE WHEN total = 0 THEN 0 ELSE ROUND((ok / total) * 100, 1) END AS pct FROM r`,
    ),
  ]);

  const apply = (i: number, defaultPct = 0) => {
    const v = usage[i]?.[0]?.pct;
    if (v == null) return defaultPct;
    const n = Number(v);
    return Number.isFinite(n) ? n : defaultPct;
  };

  tiles[0]!.usagePct = apply(0);
  tiles[1]!.usagePct = apply(1);
  tiles[2]!.usagePct = apply(2);
  tiles[3]!.usagePct = apply(3);
  tiles[4]!.usagePct = apply(4);
  tiles[5]!.usagePct = apply(5);
  tiles[6]!.usagePct = apply(6);
  tiles[7]!.usagePct = apply(7);

  // When the DB is reachable all services are considered operational — usagePct
  // reflects activity level, not service health.  A new / empty module is still
  // "operational"; only a fully saturated one (≥ 100 %) is flagged as degraded.
  for (const t of tiles) {
    t.status = t.usagePct >= 100 ? "degraded" : "operational";
  }

  return tiles;
};
