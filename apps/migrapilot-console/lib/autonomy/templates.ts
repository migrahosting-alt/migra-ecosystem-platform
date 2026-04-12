import type { ExecutionEnvironment } from "../shared/types";
import type { Finding, MissionTemplateResult, AutonomyConfig } from "./types";

export const TEMPLATE_SSL_EXPIRY = "TEMPLATE_SSL_EXPIRY";
export const TEMPLATE_POD_RESTART_INVESTIGATE = "TEMPLATE_POD_RESTART_INVESTIGATE";
export const TEMPLATE_REPO_LARGE_DIFF_REVIEW = "TEMPLATE_REPO_LARGE_DIFF_REVIEW";
export const TEMPLATE_CLASSIFICATION_DRIFT = "TEMPLATE_CLASSIFICATION_DRIFT";
export const TEMPLATE_INVESTIGATE_FAILURE = "TEMPLATE_INVESTIGATE_FAILURE";
export const TEMPLATE_DRIFT_INVESTIGATE = "TEMPLATE_DRIFT_INVESTIGATE";

export const ALL_TEMPLATE_IDS = new Set<string>([
  TEMPLATE_SSL_EXPIRY,
  TEMPLATE_POD_RESTART_INVESTIGATE,
  TEMPLATE_REPO_LARGE_DIFF_REVIEW,
  TEMPLATE_CLASSIFICATION_DRIFT,
  TEMPLATE_INVESTIGATE_FAILURE,
  TEMPLATE_DRIFT_INVESTIGATE
]);

function resolveEnvironment(config: AutonomyConfig, preferred?: ExecutionEnvironment): ExecutionEnvironment {
  if (preferred === "prod" && !config.environmentPolicy.prodAllowed) {
    return config.environmentPolicy.defaultEnv === "prod" ? "staging" : config.environmentPolicy.defaultEnv;
  }
  if (preferred) {
    return preferred;
  }
  if (config.environmentPolicy.defaultEnv === "prod" && !config.environmentPolicy.prodAllowed) {
    return "staging";
  }
  return config.environmentPolicy.defaultEnv;
}

function baseTemplate(
  templateId: string,
  goal: string,
  config: AutonomyConfig,
  input: {
    allowServer: boolean;
    defaultRunnerTarget: "auto" | "local" | "server";
    preferredEnv?: ExecutionEnvironment;
    maxWrites?: number;
    maxAffectedTenants?: number;
    notes?: string;
  }
): MissionTemplateResult {
  return {
    templateId,
    goal,
    context: {
      notes: input.notes
    },
    runnerPolicy: {
      default: input.defaultRunnerTarget,
      allowServer: input.allowServer
    },
    environment: resolveEnvironment(config, input.preferredEnv),
    constraints: {
      maxWrites: input.maxWrites ?? config.budgets.maxWritesPerMission,
      maxAffectedTenants: input.maxAffectedTenants ?? config.budgets.maxAffectedTenantsPerMission
    }
  };
}

export function templateFromFinding(finding: Finding, config: AutonomyConfig): MissionTemplateResult | null {
  const templateId = finding.suggestedMissionTemplateId ?? TEMPLATE_REPO_LARGE_DIFF_REVIEW;

  if (templateId === TEMPLATE_REPO_LARGE_DIFF_REVIEW) {
    return baseTemplate(
      TEMPLATE_REPO_LARGE_DIFF_REVIEW,
      `Fix overflow ui drift with a safe remediation plan: ${finding.title}`,
      config,
      {
        allowServer: false,
        defaultRunnerTarget: "local",
        preferredEnv: "dev",
        maxWrites: Math.min(1, config.budgets.maxWritesPerMission),
        notes: `Autonomy finding ${finding.findingId}: ${finding.details}`
      }
    );
  }

  if (templateId === TEMPLATE_POD_RESTART_INVESTIGATE) {
    return baseTemplate(
      TEMPLATE_POD_RESTART_INVESTIGATE,
      `Investigate pods instability and map dependencies before any mutation: ${finding.title}`,
      config,
      {
        allowServer: config.runnerPolicy.allowServer,
        defaultRunnerTarget: "server",
        preferredEnv: config.environmentPolicy.defaultEnv,
        maxWrites: 0,
        notes: `Autonomy finding ${finding.findingId}: ${finding.details}`
      }
    );
  }

  if (templateId === TEMPLATE_CLASSIFICATION_DRIFT) {
    return baseTemplate(
      TEMPLATE_CLASSIFICATION_DRIFT,
      `Audit classification drift between internal/client resources and produce remediation checklist: ${finding.title}`,
      config,
      {
        allowServer: config.runnerPolicy.allowServer,
        defaultRunnerTarget: "server",
        preferredEnv: config.environmentPolicy.defaultEnv,
        maxWrites: 0,
        notes: `Autonomy finding ${finding.findingId}: ${finding.details}`
      }
    );
  }

  if (templateId === TEMPLATE_SSL_EXPIRY) {
    return baseTemplate(
      TEMPLATE_SSL_EXPIRY,
      `Inspect SSL exposure and prepare remediation plan: ${finding.title}`,
      config,
      {
        allowServer: config.runnerPolicy.allowServer,
        defaultRunnerTarget: "server",
        preferredEnv: config.environmentPolicy.defaultEnv,
        maxWrites: 0,
        notes: `Autonomy finding ${finding.findingId}: ${finding.details}`
      }
    );
  }

  if (templateId === TEMPLATE_INVESTIGATE_FAILURE) {
    return baseTemplate(
      TEMPLATE_INVESTIGATE_FAILURE,
      `Investigate autonomy mission failure and produce a read-only diagnostics report: ${finding.title}`,
      config,
      {
        allowServer: false,
        defaultRunnerTarget: "local",
        preferredEnv: "dev",
        maxWrites: 0,
        notes: `Recovery mission for finding ${finding.findingId}: ${finding.details}`
      }
    );
  }

  if (templateId === TEMPLATE_DRIFT_INVESTIGATE) {
    return baseTemplate(
      TEMPLATE_DRIFT_INVESTIGATE,
      `Investigate critical inventory drift and produce a read-only remediation summary: ${finding.title}`,
      config,
      {
        allowServer: config.runnerPolicy.allowServer,
        defaultRunnerTarget: "server",
        preferredEnv: config.environmentPolicy.defaultEnv,
        maxWrites: 0,
        notes: `Drift investigation for finding ${finding.findingId}: ${finding.details}`
      }
    );
  }

  return null;
}
