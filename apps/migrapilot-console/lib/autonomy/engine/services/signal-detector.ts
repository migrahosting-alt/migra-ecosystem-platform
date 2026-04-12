import { randomUUID } from "node:crypto";

import type { Signal, SystemEvent } from "../models";

function text(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function detectSignals(events: SystemEvent[]): Signal[] {
  const signals: Signal[] = [];
  const seen = new Set<string>();

  const pushSignal = (signal: Signal) => {
    const key = `${signal.type}:${signal.summary}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(signal);
  };

  for (const item of events) {
    if (item.type === "inventory_stale") {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "infrastructure_risk",
        sourceEventIds: [item.id],
        priority: 98,
        summary: "Inventory is stale or unreadable, so infrastructure decisions are running on unreliable state.",
        confidence: 0.97,
        metadata: item.metadata
      });
      continue;
    }

    if (item.type === "inventory_sparse") {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "system_anomaly",
        sourceEventIds: [item.id],
        priority: 82,
        summary: "Inventory is unexpectedly sparse, which may hide infrastructure state from autonomy.",
        confidence: 0.88,
        metadata: item.metadata
      });
      continue;
    }

    if (item.type === "confidence_drop") {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "system_anomaly",
        sourceEventIds: [item.id],
        priority: item.severity === "critical" ? 95 : 80,
        summary: "Autonomy confidence dropped below the safety threshold.",
        confidence: 0.92,
        metadata: item.metadata
      });
      continue;
    }

    if (item.type === "automation_backlog") {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "automation_backlog",
        sourceEventIds: [item.id],
        priority: 70,
        summary: "Autonomy queue shows approvals or failed work that needs operator attention.",
        confidence: 0.85,
        metadata: item.metadata
      });
      continue;
    }

    const title = text(item.metadata, "title");
    const details = text(item.metadata, "details");
    const suggestion = text(item.metadata, "suggestion");
    const corpus = `${title} ${details}`;

    if (/autonomy action: increase_growth_output|growth\.generate_content|marketing-side|tiktok|linkedin|campaign|content/.test(`${corpus} ${suggestion}`)) {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "marketing_momentum",
        sourceEventIds: [item.id],
        priority: item.severity === "critical" ? 74 : 64,
        summary: "Recent command or activity output suggests growth momentum worth extending.",
        confidence: 0.74,
        metadata: item.metadata
      });
      continue;
    }

    if (/revenue\.advance_pipeline|proposal|lead|deal|follow-up|schedule_demo|customer/.test(`${corpus} ${suggestion}`)) {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "revenue_opportunity",
        sourceEventIds: [item.id],
        priority: 62,
        summary: "Recent pipeline activity suggests safe internal follow-up work is available.",
        confidence: 0.72,
        metadata: item.metadata
      });
      continue;
    }

    if (item.severity === "critical" || /health|cpu|load|dns|pod|infra|server/.test(corpus)) {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "infrastructure_risk",
        sourceEventIds: [item.id],
        priority: item.severity === "critical" ? 90 : 72,
        summary: "Infrastructure-related risk signal detected from autonomy findings.",
        confidence: item.severity === "critical" ? 0.93 : 0.76,
        metadata: item.metadata
      });
      continue;
    }

    if (/lead|deal|revenue|customer|proposal/.test(corpus)) {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: "revenue_opportunity",
        sourceEventIds: [item.id],
        priority: 68,
        summary: "Revenue-side movement suggests follow-up or pipeline action.",
        confidence: 0.7,
        metadata: item.metadata
      });
      continue;
    }

    if (/social|tiktok|linkedin|content|campaign|growth|marketing/.test(corpus)) {
      pushSignal({
        id: `sig_${randomUUID()}`,
        type: item.severity === "info" ? "marketing_momentum" : "growth_trend",
        sourceEventIds: [item.id],
        priority: item.severity === "info" ? 60 : 55,
        summary: "Marketing-side signal detected from recent activity.",
        confidence: 0.66,
        metadata: item.metadata
      });
    }
  }

  return signals.sort((a, b) => b.priority - a.priority);
}
