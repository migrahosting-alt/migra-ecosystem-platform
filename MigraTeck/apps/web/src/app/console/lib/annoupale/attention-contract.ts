/**
 * PURE derivation for the dashboard "Attention Required" panel.
 *
 * No server-only / next imports, so it is unit-testable. Every item is derived
 * from real, already-loaded queue signals — nothing is invented. When a loader
 * failed, its section name is surfaced as an honest "unavailable" warning rather
 * than a fabricated zero. When connected sections are all clear and nothing is
 * unavailable, `healthy` is true so the UI can show a clean all-clear state.
 */

export type AttentionSeverity = "critical" | "warning" | "info";

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href?: string;
};

export type AttentionInput = {
  complianceConnected: boolean;
  urgent: number;
  high: number;
  /** oldest open compliance case among the loaded queue window, if any */
  oldestOpen: { caseId: string; ageDays: number } | null;
  appealsConnected: boolean;
  appealsWaiting: number;
  /** display names of sections whose loader failed (bridge/API unavailable) */
  unavailableSections: string[];
};

export type AttentionResult = {
  items: AttentionItem[];
  unavailableSections: string[];
  /** true when there is nothing to attend to AND nothing failed to load */
  healthy: boolean;
};

const plural = (n: number) => (n === 1 ? "" : "s");

export function deriveAttention(input: AttentionInput): AttentionResult {
  const items: AttentionItem[] = [];

  if (input.complianceConnected && input.urgent > 0) {
    items.push({
      id: "urgent",
      severity: "critical",
      title: `${input.urgent} urgent case${plural(input.urgent)}`,
      detail: "Urgent-priority compliance cases awaiting triage.",
      href: "/console/annoupale/compliance?priority=urgent",
    });
  }

  if (input.complianceConnected && input.high > 0) {
    items.push({
      id: "high",
      severity: "warning",
      title: `${input.high} high-priority case${plural(input.high)}`,
      detail: "High-priority open compliance cases.",
      href: "/console/annoupale/compliance?priority=high",
    });
  }

  if (input.appealsConnected && input.appealsWaiting > 0) {
    items.push({
      id: "appeals-waiting",
      severity: "info",
      title: `${input.appealsWaiting} appeal${plural(input.appealsWaiting)} waiting on user`,
      detail: "Appeals are paused pending a response from the user.",
      href: "/console/annoupale/appeals",
    });
  }

  if (input.complianceConnected && input.oldestOpen) {
    const { caseId, ageDays } = input.oldestOpen;
    items.push({
      id: "oldest-open",
      severity: ageDays >= 7 ? "warning" : "info",
      title: `Oldest open case: ${caseId}`,
      detail: `Open for ${ageDays} day${plural(ageDays)} (among loaded cases).`,
      href: `/console/annoupale/compliance/${encodeURIComponent(caseId)}`,
    });
  }

  const unavailableSections = [...input.unavailableSections];
  return {
    items,
    unavailableSections,
    healthy: items.length === 0 && unavailableSections.length === 0,
  };
}
