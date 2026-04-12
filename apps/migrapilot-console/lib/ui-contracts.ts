/**
 * MigraPilot UI contracts — TypeScript prop types for all platform components.
 * Drop these into components to ensure consistent, spec-aligned interfaces.
 */

export type EnvName = "dev" | "staging" | "prod";
export type AutonomyRuntimeState = "NORMAL" | "CAUTION" | "READ_ONLY";
export type RiskTier = "T0" | "T1" | "T2";
export type Severity = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export type LinkRef = {
  label: string;
  href: string;
};

export type Badge = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  tooltip?: string;
};

export type ProofLink = LinkRef & {
  kind?: "ops-report" | "ops-release" | "activity-proof" | "other";
};

export type PrimaryAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  tone?: "primary" | "secondary" | "danger";
};

export type SecondaryAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type StatusBriefCardProps = {
  autonomyEnabled: boolean;
  env: EnvName;
  state: AutonomyRuntimeState;

  lastRelease?: {
    status: "OK" | "FAILED" | "PARTIAL" | "BLOCKED";
    runId: string;
    runIdShort?: string;
    finishedAtText?: string;
    href?: string;
  };

  drift?: {
    status: "none" | "warn" | "detected" | "unknown";
    text?: string;
    href?: string;
  };

  incidents?: {
    openCount: number;
    topIncident?: { title: string; severity: Severity; href?: string };
  };

  nextMissions?: Array<{
    id: string;
    title: string;
    etaText: string;
  }>;

  notes?: string[];

  actions: PrimaryAction[];

  onDismiss?: () => void;
};

export type ReasoningStep = {
  id: string;
  name: string;
  tier: RiskTier;
  expectedProofs?: string[];
  status?: "pending" | "running" | "ok" | "failed" | "blocked";
  detail?: string;
};

export type ReasoningCardProps = {
  intentLabel: string;
  confidencePct?: number;
  mode: "planOnly" | "executeT0T1" | "t2Approval";

  planLine?: string;
  steps: ReasoningStep[];

  proofsRequired?: string[];
  approvalNotice?: string;

  runId?: string;

  proofLinks?: ProofLink[];
  actions?: SecondaryAction[];
};

export type MissionRow = {
  id: string;
  title: string;
  scheduleText: string;
  lastRunText?: string;
  successRateText?: string;
  nextDueText?: string;
  badges?: Badge[];
  actions: Array<{
    id: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }>;
};

export type AutonomyControlPanelProps = {
  env: EnvName;
  autonomyEnabled: boolean;
  state: AutonomyRuntimeState;
  stateReason?: string;

  onToggleAutonomy: (enabled: boolean) => void;
  onRunTickNow: () => void;

  onRequestUnlock?: () => void;

  missionRows: MissionRow[];
};

export type ReleaseRow = {
  runId: string;
  env: EnvName;
  status: "OK" | "FAILED" | "PARTIAL" | "BLOCKED";
  timeText: string;
  commitShort?: string;
  durationText?: string;
  href?: string;
  proofLinks?: ProofLink[];
};

export type ReleasesTableProps = {
  env: EnvName;
  rows: ReleaseRow[];
  onSelectRow?: (runId: string) => void;
  emptyText?: string;
};

export type ReleaseStageRow = {
  name: string;
  ok: boolean;
  durationText: string;
  code?: number | null;
  timedOut?: boolean;
};

export type ReleaseDetailProps = {
  env: EnvName;
  runId: string;
  status: "OK" | "FAILED" | "PARTIAL" | "BLOCKED";
  summaryLines?: string[];

  meta?: {
    commit?: string;
    branch?: string;
    dirty?: boolean;
    startedAtText?: string;
    finishedAtText?: string;
  };

  stages: ReleaseStageRow[];

  reportLinks?: ProofLink[];
  activityProofLinks?: ProofLink[];

  actions?: PrimaryAction[];
};

export type IncidentRow = {
  id: string;
  env: EnvName;
  severity: Severity;
  status: "OPEN" | "ACK" | "RESOLVED";
  title: string;
  firstSeenText?: string;
  lastUpdateText?: string;
  dedupeKey?: string;
  runId?: string;

  evidenceLinks?: ProofLink[];

  actions: Array<{
    id: "ack" | "resolve" | "viewEvidence" | "openRunbook";
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }>;
};

export type IncidentsListProps = {
  env: EnvName;
  rows: IncidentRow[];
  emptyText?: string;
};

export type ApprovalCardProps = {
  id: string;
  env: EnvName;
  tier: RiskTier;
  status: "PENDING" | "APPROVED" | "EXECUTING" | "REJECTED" | "EXPIRED" | "EXECUTED";

  title: string;
  why: string;
  impactSummary?: string;

  expiresAtText: string;

  verificationPlanSummary?: string;
  rollbackPlanSummary?: string;

  payloadPreview?: string;

  /** Last execution result line, e.g. "Last execution: OK · 430ms" */
  executionSummary?: string;

  onApproveOnce: () => void;
  onApproveAlways: () => void;
  onReject: () => void;

  warningText?: string;
};

export type BrandType = "INTERNAL" | "CLIENT";

export type BrandCardProps = {
  id: string;
  slug: string;
  name: string;
  type: BrandType;

  primaryColor?: string;
  accentColor?: string;

  domainsCount?: number;
  socialsCount?: number;
  templatesCount?: number;
  lastCheckText?: string;

  status?: "healthy" | "needsAttention";

  onOpen: () => void;
};

export type BrandDetailProps = {
  id: string;
  slug: string;
  name: string;
  type: BrandType;

  identity?: {
    descriptionShort?: string;
    descriptionLong?: string;
  };

  assets?: {
    logoUrls?: string[];
    palette?: Array<{ name: string; value: string }>;
    fonts?: { heading?: string; body?: string };
  };

  domains?: Array<{
    host: string;
    dnsStatus?: "ok" | "fail" | "unknown";
    tlsStatus?: "ok" | "expiringSoon" | "fail" | "unknown";
    lastCheckedText?: string;
  }>;

  socials?: Array<{
    platform: string;
    url: string;
    status?: "ok" | "fail" | "unknown";
  }>;

  templates?: Array<{
    id: string;
    name: string;
    kind: "banner" | "post";
  }>;

  launchKit?: {
    status: "notGenerated" | "generated";
    updatedAtText?: string;
    previewHref?: string;
  };

  actions?: {
    runDomainCheck?: PrimaryAction;
    verifySocialLinks?: PrimaryAction;
    createBannerTemplate?: PrimaryAction;
    createPostTemplate?: PrimaryAction;
    generateLaunchKit?: PrimaryAction;
    previewLaunchKit?: SecondaryAction;
    publishLaunchKit?: PrimaryAction;
  };
};
