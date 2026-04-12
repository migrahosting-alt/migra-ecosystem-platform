export type ActivityEventKind =
  | "drift_snapshot"
  | "drift_correlated"
  | "mission_proposed"
  | "mission_started"
  | "mission_completed"
  | "mission_failed"
  | "finding_added"
  | "confidence_changed"
  | "proposal_confirmed"
  | "proposal_cancelled"
  | "autonomy_action"
  | "autonomy_action_failed"
  | "inventory_alert"
  | "suggestion";

export type ActivityIcon = "ok" | "warn" | "info" | "danger" | "thinking";

export interface ActivityEvent {
  eventId: string;
  ts: string;
  kind: ActivityEventKind;
  icon: ActivityIcon;
  title: string;
  detail?: string;
  missionId?: string;
  findingId?: string;
  confidence?: number;
  /** Signed delta from previous confidence score (positive = recovered, negative = decayed) */
  delta?: number;
  suggestion?: string;
  riskLevel?: "info" | "warn" | "critical";
}
