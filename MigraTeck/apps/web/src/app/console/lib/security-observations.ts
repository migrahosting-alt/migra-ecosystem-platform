import { panelQuery, isPanelDbConfigured } from "./db";

/**
 * Login-anomaly count, with a coverage check in front of it.
 *
 * WHY THIS FILE EXISTS
 *
 * The Security tile rendered "0 login anomalies (7d)" from
 * `SELECT COUNT(*) FROM failed_login_attempts WHERE last_attempt >= NOW() - 7d`.
 * That table has **0 rows, ever** — nothing has ever written to it. So the zero
 * was not "we looked and the estate is clean"; it was "nothing is recording
 * security events at all", displayed as a clean result.
 *
 * This is the coverage-integrity rule: 0 checked / 0 failed is NO COVERAGE, and
 * NO COVERAGE is never success. A security tile that cannot distinguish "no
 * attacks" from "no telemetry" is worse than no tile, because it actively
 * reassures.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not invent a replacement source. Several plausible candidates exist
 * (audit_events, audit_logs, webauthn_challenges, portal_profile_audit_events),
 * but picking one without tracing which service writes it, what it records, and
 * whether "anomaly" is even the right word for its rows would repeat the exact
 * mistake that produced the false zero. Establishing the real authentication
 * event source belongs to the Security page, with its own trace.
 *
 * Until then this reports UNKNOWN — NO COVERAGE, and says why.
 */

export const ANOMALY_SOURCE = "panel DB · failed_login_attempts";

export interface SecurityObservation {
  /** null means "not observed" — render an em dash, never 0. */
  count: number | null;
  /** Why the count is null, when it is. Shown to the operator. */
  reason?: string;
  source: string;
}

export const loadLoginAnomalies = async (): Promise<SecurityObservation> => {
  if (!isPanelDbConfigured()) {
    return { count: null, reason: "panel database not configured", source: ANOMALY_SOURCE };
  }

  try {
    // Ask two things at once: how many anomalies in the window, and whether the
    // table has EVER received a row. The second is the coverage test — without
    // it, an empty window and an empty feed are indistinguishable.
    const rows = await panelQuery<{ inwindow: string; everrecorded: string }>(
      `SELECT COUNT(*) FILTER (WHERE last_attempt >= NOW() - INTERVAL '7 days')::int AS inwindow,
              COUNT(*)::int AS everrecorded
         FROM failed_login_attempts`,
    );
    const r = rows[0];
    if (!r) {
      return { count: null, reason: "security query returned no result", source: ANOMALY_SOURCE };
    }

    const everRecorded = Number(r.everrecorded);
    if (!Number.isFinite(everRecorded) || everRecorded === 0) {
      return {
        count: null,
        reason: "no coverage — no security observation source is recording login events",
        source: ANOMALY_SOURCE,
      };
    }

    const inWindow = Number(r.inwindow);
    if (!Number.isFinite(inWindow)) {
      return { count: null, reason: "security count was not numeric", source: ANOMALY_SOURCE };
    }
    // The feed is live and the window is genuinely empty: a real zero.
    return { count: inWindow, source: ANOMALY_SOURCE };
  } catch {
    return { count: null, reason: "security query failed", source: ANOMALY_SOURCE };
  }
};
