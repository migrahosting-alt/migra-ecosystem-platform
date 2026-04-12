import { readAutonomyState } from "../../store";
import type { AutonomyReport } from "../models";
import { observeSystem } from "./system-observer";
import { detectSignals } from "./signal-detector";
import { decideFromSignals } from "./decision-engine";
import { orchestrateActions } from "./action-orchestrator";
import { generateStrategy } from "./strategy-generator";
import { buildExecutiveDashboard } from "./executive-dashboard";

export const SUPPORTED_AUTONOMY_COMMANDS = [
  "pilot run autonomy.observe",
  "pilot run autonomy.analyze",
  "pilot run autonomy.decide",
  "pilot run autonomy.execute",
  "pilot run autonomy.report"
];

export function buildAutonomyReport(options?: { executeLowRisk?: boolean }): AutonomyReport {
  const state = readAutonomyState();
  const events = observeSystem(state);
  const signals = detectSignals(events);
  const decisions = decideFromSignals(signals);
  const actions = orchestrateActions(decisions, options);
  const strategy = generateStrategy(signals, decisions);
  const dashboard = buildExecutiveDashboard(state, signals, actions.length);

  return {
    generatedAt: new Date().toISOString(),
    events,
    signals,
    decisions,
    actions,
    strategy,
    dashboard,
    supportedCommands: SUPPORTED_AUTONOMY_COMMANDS
  };
}
