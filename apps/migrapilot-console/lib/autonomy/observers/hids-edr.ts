import { createFinding } from "../finding";
import { readHidsEdrEvents } from "../hids-edr-store";
import { TEMPLATE_HOST_INTRUSION_RESPONSE } from "../templates";
import type { Finding, ObserverContext } from "../types";

const MAX_EVENTS_PER_CYCLE = 20;
const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;

export async function hidsEdrObserver(context: ObserverContext): Promise<Finding[]> {
  const events = await readHidsEdrEvents();
  if (events.length === 0) {
    return [];
  }

  const lookbackMs = Number(process.env.MIGRAPILOT_HIDS_EDR_LOOKBACK_MS ?? DEFAULT_LOOKBACK_MS);
  const cutoff = context.now.getTime() - (Number.isFinite(lookbackMs) && lookbackMs > 0 ? lookbackMs : DEFAULT_LOOKBACK_MS);

  const findings: Finding[] = [];
  for (const event of events) {
    if (new Date(event.ts).getTime() < cutoff) {
      continue;
    }

    findings.push(
      createFinding({
        source: "hids_edr",
        severity: event.severity,
        title: `HIDS/EDR alert on ${event.host}: ${event.indicator}`,
        details: `${event.details}\nhost=${event.host}\nindicator=${event.indicator}`,
        classification: event.classification ?? "internal",
        tenantId: event.tenantId,
        suggestedMissionTemplateId: TEMPLATE_HOST_INTRUSION_RESPONSE,
        ts: event.ts
      })
    );

    if (findings.length >= MAX_EVENTS_PER_CYCLE) {
      break;
    }
  }

  return findings;
}
