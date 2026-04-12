export type SystemEventSeverity = "info" | "warn" | "critical";
export type SignalType =
  | "marketing_momentum"
  | "revenue_opportunity"
  | "infrastructure_risk"
  | "system_anomaly"
  | "growth_trend"
  | "automation_backlog";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ActionExecutionStatus = "planned" | "gated" | "deferred" | "simulated";

export interface SystemEvent {
  id: string;
  source: "autonomy" | "finding" | "queue" | "confidence" | "activity" | "run" | "inventory";
  type: string;
  severity: SystemEventSeverity;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface Signal {
  id: string;
  type: SignalType;
  sourceEventIds: string[];
  priority: number;
  summary: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface Decision {
  id: string;
  signalId: string;
  recommendedAction: string;
  confidence: number;
  priority: number;
  rationale: string;
}

export interface ActionRisk {
  level: RiskLevel;
  requiresOwnerApproval: boolean;
  reason: string;
}

export interface Action {
  id: string;
  type: string;
  targetSystem: string;
  parameters: Record<string, unknown>;
  executionStatus: ActionExecutionStatus;
  risk: ActionRisk;
  suggestedCommand?: string;
}

export interface StrategyRecommendation {
  id: string;
  title: string;
  summary: string;
  reason: string;
  priority: number;
}

export interface ExecutiveMetric {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}

export interface ExecutiveDashboardSnapshot {
  generatedAt: string;
  metrics: ExecutiveMetric[];
  topSignal?: Signal;
  openRisks: number;
  recommendedActions: number;
}

export interface AutonomyReport {
  generatedAt: string;
  events: SystemEvent[];
  signals: Signal[];
  decisions: Decision[];
  actions: Action[];
  strategy: StrategyRecommendation[];
  dashboard: ExecutiveDashboardSnapshot;
  supportedCommands: string[];
}
