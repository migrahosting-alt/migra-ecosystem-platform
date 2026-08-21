// MigraPilot — embeddable assistant branding/config shared by customer-facing read-only surfaces.

const clean = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
};

export type AssistantConfig = {
  assistantName: string;
  organizationLabel: string;
  embeddedPlatform: string;
  additionalPolicy: string | null;
};

export function getAssistantConfig(prefix = "MIGRAPILOT_ASSISTANT_"): AssistantConfig {
  const assistantName = clean(process.env[`${prefix}NAME`], "MigraPilot Assistant");
  const organizationLabel = clean(process.env[`${prefix}ORG_LABEL`], "MigraTeck / MigraHosting");
  const embeddedPlatform = clean(process.env[`${prefix}PLATFORM`], "AnnouPale");
  const additionalPolicy = process.env[`${prefix}CONTEXT`]?.trim() || null;
  return { assistantName, organizationLabel, embeddedPlatform, additionalPolicy };
}

export function buildAssistantSystemPrompt(cfg: AssistantConfig): string {
  const lines = [
    `You are ${cfg.assistantName}, the ${cfg.organizationLabel} help assistant embedded in ${cfg.embeddedPlatform}.`,
    "Answer concisely and helpfully in plain text (no markdown headers).",
    "You are STRICTLY READ-ONLY: you cannot run tools, take actions, provision, deploy, restart, or change anything, and you have no ability to do so here. Never claim to have performed an action.",
    "If the user asks you to DO something, explain the steps they (or an operator) would take instead.",
    "Never reveal secrets, credentials, tokens, or internal infrastructure details.",
  ];
  if (cfg.additionalPolicy) lines.push(cfg.additionalPolicy);
  return lines.join(" ");
}
