import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAnalyticsSummary,
  parseAnalyticsRealtime,
  fmtRate,
  fmtDelta,
} from "./analytics-contract.ts";

test("parseAnalyticsSummary: surfaces only present metrics, never fabricates", () => {
  const r = parseAnalyticsSummary({
    window: { from: "2026-05-01", to: "2026-06-06" },
    totalEvents: 245000,
    eventCounts: [
      { eventName: "otp_requested", count: 12500 },
      { eventName: "report_submitted", count: 156 },
      { eventName: "", count: 99 }, // dropped (no name)
    ],
    trends: {
      topDropOffStep: { step: "profile_to_onboarding", lostRate: 0.27 },
      trendCards: {
        otpVerificationRate: { current: 0.816, previous: 0.812, delta: 0.004 },
        searchVolume: { current: 450, previous: 440, delta: 10 },
        // onboardingCompletionRate + suggestionCTR absent → not produced
      },
    },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.totalEvents, 245000);
  assert.equal(r.data.topEvents.length, 2);
  assert.equal(r.data.topEvents[0].name, "otp_requested"); // sorted desc
  assert.equal(r.data.cards.length, 2); // only the two present
  assert.equal(r.data.topDropOff?.step, "profile_to_onboarding");
});

test("parseAnalyticsSummary: missing totals stay null (no zero fabrication)", () => {
  const r = parseAnalyticsSummary({ eventCounts: [] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.totalEvents, null);
  assert.equal(r.data.cards.length, 0);
  assert.equal(r.data.topDropOff, null);
});

test("parseAnalyticsRealtime: tolerant of missing fields", () => {
  const r = parseAnalyticsRealtime({ activeUsers: 12 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.activeUsers, 12);
  assert.equal(r.data.eventsLastHour, null);
});

test("fmtRate / fmtDelta formatting", () => {
  assert.equal(fmtRate(0.816), "81.6%");
  assert.equal(fmtRate(null), "—");
  assert.equal(fmtDelta(0.004, "rate"), "+0.4 pts");
  assert.equal(fmtDelta(-3, "count"), "-3");
  assert.equal(fmtDelta(null, "rate"), "");
});
