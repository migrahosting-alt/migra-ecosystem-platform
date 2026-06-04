import { panelQuery, isPanelDbConfigured } from "../db";

export type AnalyticsEvent = { id: string; eventType: string | null; siteId: string | null; createdAt: string | null };
export type ConversionGoal = { id: string; name: string | null; eventCount: number };
export type ServiceEvent = { id: string; kind: string | null; status: string | null; createdAt: string | null };

export const loadAnalyticsData = async () => {
  if (!isPanelDbConfigured()) return { events: [], goals: [], serviceEvents: [] };
  const [events, goals, serviceEvents] = await Promise.all([
    panelQuery<{ id: string; eventtype: string | null; siteid: string | null; createdat: string | null }>(
      `SELECT id, "eventType" AS eventtype, "siteId" AS siteid, "createdAt"::text AS createdat
         FROM builder_analytics_events
        ORDER BY "createdAt" DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; name: string | null; eventcount: string }>(
      `SELECT id, name,
              COALESCE((SELECT COUNT(*) FROM builder_analytics_events e WHERE e."eventType" = g."eventType"), 0)::text AS eventcount
         FROM builder_conversion_goals g
        ORDER BY g."createdAt" DESC NULLS LAST
        LIMIT 30`,
    ),
    panelQuery<{ id: string; kind: string | null; status: string | null; createdat: string | null }>(
      `SELECT id, type AS kind, NULL::text AS status, "at"::text AS createdat
         FROM service_events
        ORDER BY "at" DESC NULLS LAST
        LIMIT 30`,
    ),
  ]);
  return {
    events: events.map((e) => ({ id: e.id, eventType: e.eventtype, siteId: e.siteid, createdAt: e.createdat })),
    goals: goals.map((g) => ({ id: g.id, name: g.name, eventCount: Number(g.eventcount) || 0 })),
    serviceEvents: serviceEvents.map((s) => ({ id: s.id, kind: s.kind, status: s.status, createdAt: s.createdat })),
  };
};
