import { z } from "zod";

/**
 * Contract gate for AnnouPale platform analytics
 * (GET /api/admin/analytics/summary?includeTrends=true and .../realtime).
 *
 * PURE module (no server-only / next imports) so it is unit-testable. The
 * analytics payload is large and evolves; we parse VERY defensively and surface
 * only a safe, render-ready subset. Anything missing simply isn't shown — we
 * never fabricate a metric.
 */

const TrendCard = z
  .object({
    current: z.number().nullish(),
    previous: z.number().nullish(),
    delta: z.number().nullish(),
  })
  .nullish();

const RawSummary = z
  .object({
    window: z.object({ from: z.string().nullish(), to: z.string().nullish() }).nullish(),
    totalEvents: z.number().nullish(),
    eventCounts: z
      .array(z.object({ eventName: z.string().nullish(), count: z.number().nullish() }))
      .nullish(),
    trends: z
      .object({
        topDropOffStep: z
          .object({
            step: z.string().nullish(),
            lostCount: z.number().nullish(),
            lostRate: z.number().nullish(),
          })
          .nullish(),
        trendCards: z
          .object({
            otpVerificationRate: TrendCard,
            onboardingCompletionRate: TrendCard,
            suggestionCTR: TrendCard,
            searchVolume: TrendCard,
          })
          .nullish(),
      })
      .nullish(),
  })
  .passthrough();

const RawRealtime = z
  .object({
    activeUsers: z.number().nullish(),
    eventsLastHour: z.number().nullish(),
  })
  .passthrough();

export type AnalyticsMetricCard = {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  /** "rate" → render as %; "count" → render as integer */
  format: "rate" | "count";
};

export type AnalyticsEventCount = { name: string; count: number };

export type AnalyticsSummary = {
  windowFrom: string;
  windowTo: string;
  totalEvents: number | null;
  topEvents: AnalyticsEventCount[];
  cards: AnalyticsMetricCard[];
  topDropOff: { step: string; lostRate: number | null } | null;
};

export type AnalyticsRealtime = {
  activeUsers: number | null;
  eventsLastHour: number | null;
};

const s = (v: unknown): string => (typeof v === "string" && v.length ? v : "");
const n = (v: unknown): number | null => (typeof v === "number" ? v : null);

function card(
  key: string,
  label: string,
  format: "rate" | "count",
  raw:
    | {
        current?: number | null | undefined;
        previous?: number | null | undefined;
        delta?: number | null | undefined;
      }
    | null
    | undefined,
): AnalyticsMetricCard | null {
  if (!raw) return null;
  const current = n(raw.current);
  if (current === null) return null;
  return { key, label, format, current, previous: n(raw.previous), delta: n(raw.delta) };
}

export function parseAnalyticsSummary(
  json: unknown,
): { ok: true; data: AnalyticsSummary } | { ok: false } {
  const parsed = RawSummary.safeParse(json);
  if (!parsed.success) return { ok: false };
  const d = parsed.data;
  const tc = d.trends?.trendCards;

  const cards = [
    card("otpVerificationRate", "OTP verification", "rate", tc?.otpVerificationRate),
    card("onboardingCompletionRate", "Onboarding completion", "rate", tc?.onboardingCompletionRate),
    card("suggestionCTR", "Suggestion CTR", "rate", tc?.suggestionCTR),
    card("searchVolume", "Search volume", "count", tc?.searchVolume),
  ].filter((c): c is AnalyticsMetricCard => c !== null);

  const topEvents: AnalyticsEventCount[] = (d.eventCounts ?? [])
    .map((e) => ({ name: s(e.eventName), count: n(e.count) ?? 0 }))
    .filter((e) => e.name.length > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const drop = d.trends?.topDropOffStep;
  const topDropOff =
    drop && s(drop.step)
      ? { step: s(drop.step), lostRate: n(drop.lostRate) }
      : null;

  return {
    ok: true,
    data: {
      windowFrom: s(d.window?.from),
      windowTo: s(d.window?.to),
      totalEvents: n(d.totalEvents),
      topEvents,
      cards,
      topDropOff,
    },
  };
}

export function parseAnalyticsRealtime(
  json: unknown,
): { ok: true; data: AnalyticsRealtime } | { ok: false } {
  const parsed = RawRealtime.safeParse(json);
  if (!parsed.success) return { ok: false };
  return {
    ok: true,
    data: {
      activeUsers: n(parsed.data.activeUsers),
      eventsLastHour: n(parsed.data.eventsLastHour),
    },
  };
}

/** Format a rate (0..1) as a percentage string, or — when null. */
export function fmtRate(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** Format a delta for a rate/count card. */
export function fmtDelta(v: number | null, format: "rate" | "count"): string {
  if (v === null) return "";
  const sign = v > 0 ? "+" : "";
  if (format === "rate") return `${sign}${(v * 100).toFixed(1)} pts`;
  return `${sign}${v}`;
}
