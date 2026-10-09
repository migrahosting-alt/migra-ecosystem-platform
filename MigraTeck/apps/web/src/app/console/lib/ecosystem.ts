import { panelQuery, isPanelDbConfigured } from "./db";
import { type Health, deriveProductHealth, unknown as unknownHealth } from "./fleet/health-contract";
import type { ServiceHealth } from "./health";

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

export interface ProductActivity {
  pct: number;
  /** What the percentage is OF, in the operator's words. */
  describes: string;
}

export type ProductTile = {
  id: string;
  initials: string;
  name: string;
  subtitle: string;
  logoSrc: string;
  logoAlt: string;
  /**
   * Activity, with the denominator it is a percentage OF.
   *
   * It used to be a bare `usagePct: number`, and every product computed it from
   * a different denominator — % of users who logged in this week, % of websites
   * active, audit events vs a trailing average, % of phone extensions enabled,
   * % of successful job runs. Rendered under one word "Activity" and averaged
   * into an "Avg Activity" index, that told the operator a number answering no
   * question. A metric now has to say what it measures.
   *
   * null means NOT MEASURED, which is different from 0. AnnouPale and Pale
   * carried a hard-coded 0 and rendered an empty bar that read as idleness.
   */
  activity: ProductActivity | null;
  /**
   * Evidence-bearing health. Replaces the old `status` string, which any line of
   * code could set to "operational" — and one did, unconditionally, for all
   * eight tiles on every request where the database happened to be reachable.
   * A positive state is now unconstructable without observedAt/source/expiresAt.
   */
  health: Health;
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

/**
 * PRODUCT DEPENDENCY GRAPH — the input to the one canonical health resolver.
 *
 * WHY THIS EXISTS
 *
 * Every tile below used to receive `unknownHealth("no product health observation
 * source exists yet")` unconditionally. That sentence was false for six of them:
 * a source did exist — `lib/health.ts` probes their service on every request and
 * the Overview page renders the result directly above this grid. So the console
 * showed "Healthy" and "Unknown" for the same six products, in the same render,
 * and both panels were internally consistent while contradicting each other.
 *
 * The fix is NOT to copy the probe verdict onto the tile. Service reachability
 * and product health are different questions, and equating them is the "tile
 * borrows another product's health endpoint" defect. The fix is to say which
 * observations a product actually depends on and let `deriveProductHealth`
 * combine them — required-down means down, required-unknown means unknown, and
 * a positive verdict is unconstructable without real evidence.
 *
 * A product with no declared dependency stays UNKNOWN. That is still the honest
 * answer for AnnouPale and Pale — but now the reason says which observation is
 * missing instead of claiming no source could exist.
 *
 * Adding a product here does NOT grant it a green light. It grants it the right
 * to inherit the state of evidence that genuinely constrains it.
 */
const PRODUCT_DEPENDENCIES: Record<string, ReadonlyArray<{ serviceId: string; required: boolean }>> = {
  migrateck: [{ serviceId: "migrateck-core", required: true }],
  hosting: [{ serviceId: "hosting", required: true }],
  panel: [{ serviceId: "panel", required: true }],
  voice: [{ serviceId: "voice", required: true }],
  email: [{ serviceId: "email", required: true }],
  intake: [{ serviceId: "intake", required: true }],
  marketing: [{ serviceId: "marketing", required: true }],
  automation: [{ serviceId: "automation", required: true }],
};

/**
 * The service instances a product depends on, by id.
 *
 * Exported so the four-level read model composes from the SAME declaration the
 * health resolver uses. A second list of "which services belong to this
 * product" would be a second authority, and the two would drift.
 */
export const serviceIdsFor = (productId: string): ReadonlyArray<string> =>
  (PRODUCT_DEPENDENCIES[productId] ?? []).map((d) => d.serviceId);

/** How long a derived product verdict stays current. Never longer than the
 *  probe TTL it is derived from, so a product can never outlive its evidence. */
const PRODUCT_TTL_MS = 60_000;

/**
 * Resolve one product's health from the shared observation set.
 *
 * `services` is passed in rather than fetched here on purpose. If this module
 * probed independently, the grid and the service table would be two separate
 * observations of the same estate taken milliseconds apart — which is precisely
 * how they came to disagree. One observation, many renderings.
 */
const productHealth = (
  productId: string,
  services: ReadonlyArray<ServiceHealth>,
): Health => {
  const declared = PRODUCT_DEPENDENCIES[productId];
  if (!declared || declared.length === 0) {
    return unknownHealth("no dependency is declared for this product yet");
  }

  const deps = declared.map((d) => {
    const svc = services.find((s) => s.id === d.serviceId);
    return {
      required: d.required,
      label: svc?.label ?? d.serviceId,
      health: svc?.health ?? unknownHealth(`dependency "${d.serviceId}" is not in the probe set`),
    };
  });

  // The derived verdict is only as fresh as its OLDEST input, so it expires
  // with the first dependency to go stale rather than outliving its evidence.
  const observedTimes = deps
    .map((d) => (d.health.state === "unknown" ? null : Date.parse(d.health.observedAt)))
    .filter((t): t is number => t !== null && Number.isFinite(t));
  const observedAt = observedTimes.length > 0 ? new Date(Math.min(...observedTimes)) : new Date();

  return deriveProductHealth(deps, {
    observedAt,
    ttlMs: PRODUCT_TTL_MS,
    source: `derived from ${deps.map((d) => d.label).join(", ")}`,
  });
};

const productTile = (
  services: ReadonlyArray<ServiceHealth>,
  id: string,
  name: string,
  subtitle: string,
  initials: string,
  accent: string,
  primaryHref: string,
  secondaryHref: string,
  secondaryLabel = "Reports",
): ProductTile => ({
  id,
  initials,
  name,
  subtitle,
  logoSrc: PRODUCT_LOGOS[id]?.src ?? "/brands/products/migrateck.png",
  logoAlt: PRODUCT_LOGOS[id]?.alt ?? `${name} logo`,
  activity: null,
  // Still fails closed — a usage percentage is not a health observation and
  // never becomes one. What changed is that the tile now consumes the estate's
  // real dependency observations instead of asserting that none exist.
  health: productHealth(id, services),
  primaryAction: { label: "Open", href: primaryHref },
  secondaryAction: { label: secondaryLabel, href: secondaryHref },
  accent,
});

/**
 * AnnouPale Trust & Operations.
 *
 * Unlike the eight tiles above, AnnouPale is an external product with its own
 * admin surface and database, so it has no panel-DB usage metric. We therefore
 * report an honest 0.0% activity (the panel can't measure it) and a live
 * "operational" status. The primary action opens the native in-console module
 * (/console/annoupale); the secondary deep-links to the AnnouPale compliance
 * queue. Neither grants any AnnouPale permission — annoupale.com/admin still
 * enforces its own platform_admin / trust_safety_admin roles. Apex URLs only.
 */
const annoupaleTile = (): ProductTile => ({
  id: "annoupale",
  initials: "AP",
  name: "AnnouPale",
  subtitle: "Social & Community Platform",
  logoSrc: "/brands/products/annoupale.png",
  logoAlt: "AnnouPale logo",
  activity: null,
  // Previously the literal `status: "operational"` with no probe behind it.
  health: unknownHealth("AnnouPale health is not probed by the console yet"),
  primaryAction: { label: "Open", href: "/console/annoupale" },
  secondaryAction: { label: "Compliance", href: "https://annoupale.com/admin/compliance/cases" },
  accent: "from-fuchsia-500 to-amber-400",
});

/**
 * Pale — phone-first mobile messaging app of the AnnouPale ecosystem
 * (com.migrateck.pale). Like AnnouPale it has no panel-DB usage metric, so it
 * reports an honest 0.0% activity. But its backend (pale-api) is colocated on
 * app-core with the console, so the native /console/pale module performs a real
 * live health probe (see lib/pale.ts). The secondary action deep-links to the
 * Google Play listing. Status is "operational" by default; the live backend
 * state is shown inside the module rather than faked on the tile.
 */
const paleTile = (): ProductTile => ({
  id: "pale",
  initials: "PA",
  name: "Pale",
  subtitle: "Phone-First Messaging App",
  logoSrc: "/brands/products/pale.png",
  logoAlt: "Pale logo",
  activity: null,
  // Previously the literal `status: "operational"`. The live pale-api probe
  // lives inside /console/pale; the tile must not assert what it never checked.
  health: unknownHealth("Pale backend health is probed inside /console/pale, not on this tile"),
  primaryAction: { label: "Open", href: "/console/pale" },
  secondaryAction: {
    label: "Play Store",
    href: "https://play.google.com/store/apps/details?id=com.migrateck.pale",
  },
  accent: "from-sky-500 to-violet-500",
});

/**
 * Build the product grid from the SHARED observation set.
 *
 * `services` is a required parameter, not an internal fetch. That is the whole
 * point: the Overview page probes once and hands the same array to both the
 * service table and this grid, so the two surfaces are renderings of one
 * observation and cannot contradict each other. Making it a parameter means a
 * future caller cannot accidentally reintroduce a second, independent probe —
 * the type checker demands the evidence.
 */
export const loadEcosystem = async (
  services: ReadonlyArray<ServiceHealth>,
): Promise<ProductTile[]> => {
  const tiles: ProductTile[] = [
    productTile(services, "migrateck", "MigraTeck", "Core Platform", "MT", ACCENTS.migrateck!, "/console/ecosystem", "/console/activity", "Operations"),
    productTile(services, "hosting", "Hosting", "Web Hosting", "MH", ACCENTS.hosting!, "/console/hosting", "/console/domains", "Domains"),
    productTile(services, "panel", "MigraPanel", "Client Portal", "MP", ACCENTS.panel!, "/console/clients", "/console/team", "Staff"),
    productTile(services, "voice", "Voice", "VoIP System", "MV", ACCENTS.voice!, "/console/voice", "/console/support", "Tickets"),
    productTile(services, "email", "Email", "Email Services", "MM", ACCENTS.email!, "/console/email", "/console/mail", "Inbox"),
    productTile(services, "intake", "Intake", "Intake Forms", "MI", ACCENTS.intake!, "/console/intake", "/console/analytics", "Analytics"),
    productTile(services, "marketing", "Marketing", "Marketing Suite", "MK", ACCENTS.marketing!, "/console/marketing", "/console/analytics", "Analytics"),
    productTile(services, "automation", "Automation", "Workflows", "AU", ACCENTS.automation!, "/console/automation", "/console/activity?failures=1", "Failures"),
  ];

  // External products (deep-linked, no panel-DB metric) are appended after the
  // eight internal modules so the indexed usage `apply()` below stays aligned.
  if (!isPanelDbConfigured()) return [...tiles, annoupaleTile(), paleTile()];

  const usage = await Promise.all([
    /*
     * MigraTeck Core: of active users we have EVER observed signing in, how many
     * signed in within 7 days.
     *
     * 🚨 The denominator is the OBSERVED population, not every active user, and
     * the operator-facing text says so. The previous version divided by every
     * active user and rendered "0.0% of active users signed in within 7 days"
     * on production — while `last_login_at` is NULL for all 19 users in the
     * panel database, including the admin account that had signed in minutes
     * earlier. Nothing writes that column here; the only writer of
     * last_login_at in this repo is apps/auth-api, which is MigraAuth's own,
     * different database.
     *
     * That was not the zero-denominator bug. The guard fired correctly, because
     * the denominator was real. It was a NUMERATOR that can never be non-zero —
     * 0/N where N can never be matched — which is not a measurement, and it
     * stated total absence as confidently as the old 0/0 stated total failure.
     *
     * Measuring the population we can actually see makes it truthful in both
     * directions: with no telemetry, `observed` is 0 and this returns NULL, so
     * the UI says NOT MEASURED. The day sign-ins start being recorded it becomes
     * meaningful on its own, with no fabricated zero in between.
     *
     * `recent` is a strict subset of `observed` by construction — a row that
     * satisfies the timestamp comparison cannot have a NULL timestamp — so the
     * ratio cannot exceed 100 and the old LEAST(100, …) clamp is gone. A clamp
     * here would only ever hide a defect in the pairing of the two filters.
     *
     * Both filters keep this file's existing definition of an active user,
     * COALESCE(is_active, TRUE), so this change moves ONLY the denominator's
     * population and not who counts as active.
     */
    panelQuery<{ pct: string }>(
      `WITH u AS (
         SELECT
           COUNT(*) FILTER (
             WHERE COALESCE(is_active, TRUE) = TRUE
               AND last_login_at IS NOT NULL
           ) AS observed,
           COUNT(*) FILTER (
             WHERE COALESCE(is_active, TRUE) = TRUE
               AND last_login_at >= NOW() - INTERVAL '7 days'
           ) AS recent
           FROM users
       )
       SELECT CASE WHEN observed = 0 THEN NULL
                   ELSE ROUND((recent::numeric * 100.0) / observed, 1) END AS pct
         FROM u`,
    ),
    // Hosting: % of websites currently active
    panelQuery<{ pct: string }>(
      `WITH a AS (SELECT COUNT(*) AS active FROM websites WHERE status = 'active'),
            t AS (SELECT COUNT(*) AS total FROM websites)
       SELECT CASE WHEN t.total = 0 THEN NULL
                   ELSE ROUND((a.active::numeric / t.total) * 100, 1) END AS pct
         FROM a, t`,
    ),
    // MigraPanel: audit_events last 24h vs trailing 7d daily avg
    panelQuery<{ pct: string }>(
      `SELECT CASE WHEN trailing = 0 THEN NULL
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
       SELECT CASE WHEN t.total = 0 THEN NULL
                   ELSE ROUND((a.active::numeric / t.total) * 100, 1) END AS pct
         FROM a, t`,
    ),
    // Email: % of mailboxes with active status
    panelQuery<{ pct: string }>(
      `WITH a AS (SELECT COUNT(*) AS active FROM mailboxes WHERE COALESCE(status, 'active') = 'active'),
            t AS (SELECT COUNT(*) AS total FROM mailboxes)
       SELECT CASE WHEN t.total = 0 THEN NULL
                   ELSE ROUND((a.active::numeric / t.total) * 100, 1) END AS pct
         FROM a, t`,
    ),
    // Intake: growth_leads last 30d vs builder_form_bindings count
    panelQuery<{ pct: string }>(
      `WITH s AS (SELECT COUNT(*) AS submitted FROM growth_leads WHERE createdat >= NOW() - INTERVAL '30 days'),
            f AS (SELECT COUNT(*) AS forms FROM builder_form_bindings)
       SELECT CASE WHEN f.forms = 0 THEN NULL
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
       SELECT CASE WHEN t.total = 0 THEN NULL
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
       SELECT CASE WHEN total = 0 THEN NULL ELSE ROUND((ok / total) * 100, 1) END AS pct FROM r`,
    ),
  ]);

  /**
   * null means NOT MEASURABLE — which is not 0%.
   *
   * Every one of these queries guards its denominator, and each used to return
   * 0 when the denominator was zero. That is wrong in the most misleading
   * direction: with no job runs in the window, 0/0 rendered as
   * "0.0% of job runs succeeded in the last 7 days" — a confident statement of
   * total failure derived from no observations at all. The guards now return
   * NULL and it travels all the way to the UI as "not measured".
   */
  const apply = (i: number): number | null => {
    const v = usage[i]?.[0]?.pct;
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Each metric carries the denominator it is a percentage OF, so the UI can
  // state it and no caller can average them into a meaningless index.
  const DESCRIBES = [
    "of active users with recorded sign-in telemetry signed in within 7 days",
    "of websites currently active",
    "of audit events vs the trailing 7-day daily average",
    "of phone extensions enabled",
    "of mailboxes active",
    "of intake capacity used in the last 30 days",
    "of this quarter's GBP posts published",
    "of job runs succeeded in the last 7 days",
  ];
  for (let i = 0; i < 8; i++) {
    const pct = apply(i);
    tiles[i]!.activity = pct === null ? null : { pct, describes: DESCRIBES[i]! };
  }

  // REMOVED (Phase 0A): an unconditional `t.status = "operational"` for every
  // tile. Reaching the database proves the database is reachable and nothing
  // whatsoever about MigraVoice, MigraMail, Intake or Marketing. Health is left
  // UNKNOWN here by design; only the observation plane may raise it.

  return [...tiles, annoupaleTile(), paleTile()];
};
