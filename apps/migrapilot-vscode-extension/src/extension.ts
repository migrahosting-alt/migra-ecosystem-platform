import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  BrainClient,
  getAuthorizationHeader,
  getBrainClientConfig,
  isBrainConnectionError,
  isLocalBrainUrl,
  probeBrainHealth,
} from "./brainClient.js";
import { ChatViewProvider } from "./chatViewProvider.js";
import { MigraCompletionProvider } from "./completionProvider.js";

interface LastPatchState {
  missionId: string;
  filePath: string;
  beforeText: string;
  afterText: string;
  appliedByMission: boolean;
  patch?: string;
}

const LAST_PATCH_KEY = "migrapilot.lastPatch";

type RegistrySummary = {
  commands: number | null;
  products: number | null;
  infrastructureNodes: number | null;
  services: number | null;
  incidentSeverities: number | null;
  tenantLifecycleStates: number | null;
};

type ServiceRegistryEntry = {
  serviceName: string;
  product: string;
  server: string;
  serviceType: string;
  exposure: string;
  protocols?: string[];
  endpoints?: string[];
  healthcheck?: string;
  dependencies?: string[];
  criticality?: string;
  managedBy?: string;
};

type IncidentSeverityLevel = {
  id: string;
  name: string;
  description: string;
  impact?: string;
  immediateActions?: string[];
};

type IncidentEscalationLevel = {
  id: string;
  description: string;
};

type IncidentRegistry = {
  severityLevels?: IncidentSeverityLevel[];
  escalationLevels?: IncidentEscalationLevel[];
  allowedAutomations?: string[];
};

type CommandRegistryEntry = {
  id: string;
  title: string;
  description: string;
  domain: string;
  product: string;
  riskTier: number;
  productionImpact: boolean;
  requiredCapabilities?: string[];
  targetHosts?: string[];
};

type TenantEntitlement = {
  product: string;
  capability: string;
};

type TenantRegistry = {
  lifecycleStates?: string[];
  entitlements?: TenantEntitlement[];
  requiredValidationChecks?: string[];
};

type PreflightAuditRecord = {
  runId: string;
  timestamp: string;
  commandId: string;
  commandTitle: string;
  domain: string;
  product: string;
  riskTier: number;
  productionImpact: boolean;
  service?: string;
  serviceCriticality?: string;
  dependencyImpact?: string;
  tenantState?: string;
  entitlementMatch?: string;
  approvalRequired: boolean;
  blocked: boolean;
  reasons: string[];
  validationChecks: string[];
};

type AuditRecordReference = {
  filePath: string;
  record: PreflightAuditRecord;
};

function getOperator(): { operatorId: string; role: string } {
  const cfg = getBrainClientConfig();
  return {
    operatorId: cfg.operatorId ?? "vscode-operator",
    role: "operator"
  };
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getWorkspaceFilePath(relativePath: string): string | undefined {
  const root = getWorkspaceRoot();
  return root ? path.join(root, relativePath) : undefined;
}

function getAuditDirectory(): string | undefined {
  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }

  const configuredPath = vscode.workspace
    .getConfiguration("migrapilot")
    .get<string>("auditPath", ".migrapilot/audit");

  return path.join(root, configuredPath);
}

function generateRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `mp-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function writeAuditRecord(record: PreflightAuditRecord): string | undefined {
  const auditDirectory = getAuditDirectory();
  if (!auditDirectory) {
    return undefined;
  }

  fs.mkdirSync(auditDirectory, { recursive: true });
  const filePath = path.join(auditDirectory, `${record.runId}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return filePath;
}

async function openLatestAuditRecord(): Promise<void> {
  const latestRecord = readLatestAuditRecord();
  if (!latestRecord) {
    vscode.window.showWarningMessage("MigraPilot has not written any audit records yet.");
    return;
  }

  const doc = await vscode.workspace.openTextDocument(latestRecord.filePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

function readLatestAuditRecord(): AuditRecordReference | undefined {
  const auditDirectory = getAuditDirectory();
  if (!auditDirectory || !fs.existsSync(auditDirectory)) {
    return undefined;
  }

  const latestFile = fs.readdirSync(auditDirectory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .pop();

  if (!latestFile) {
    return undefined;
  }

  const filePath = path.join(auditDirectory, latestFile);
  const raw = fs.readFileSync(filePath, "utf8");
  return {
    filePath,
    record: JSON.parse(raw) as PreflightAuditRecord
  };
}

function getPreflightMaxAgeMinutes(): number {
  return vscode.workspace
    .getConfiguration("migrapilot")
    .get<number>("preflightMaxAgeMinutes", 30);
}

function shouldRequirePreflightForRemoteWrites(): boolean {
  return vscode.workspace
    .getConfiguration("migrapilot")
    .get<boolean>("requirePreflightForRemoteWrites", true);
}

function isAuditFresh(record: PreflightAuditRecord): boolean {
  const createdAt = new Date(record.timestamp).getTime();
  if (Number.isNaN(createdAt)) {
    return false;
  }

  const ageMs = Date.now() - createdAt;
  return ageMs <= getPreflightMaxAgeMinutes() * 60_000;
}

async function promptToRunPreflight(message: string): Promise<boolean> {
  const action = await vscode.window.showWarningMessage(message, "Run Preflight", "Cancel");
  if (action === "Run Preflight") {
    await vscode.commands.executeCommand("migrapilot.preflightOperation");
  }
  return false;
}

async function getExecutionSafetyContext(params: {
  operationLabel: string;
  requireFreshPreflight: boolean;
  requireApprovalConfirmation: boolean;
}): Promise<{ runId?: string; claims?: Record<string, unknown> } | undefined> {
  const latestAudit = readLatestAuditRecord();
  if (!latestAudit) {
    if (!params.requireFreshPreflight) {
      return undefined;
    }
    return (await promptToRunPreflight(
      `MigraPilot needs a recent preflight audit before it can ${params.operationLabel}.`
    )) ? undefined : undefined;
  }

  if (!isAuditFresh(latestAudit.record)) {
    if (!params.requireFreshPreflight) {
      return undefined;
    }
    return (await promptToRunPreflight(
      `The latest preflight audit ${latestAudit.record.runId} is older than ${getPreflightMaxAgeMinutes()} minutes. Run preflight again before ${params.operationLabel}.`
    )) ? undefined : undefined;
  }

  if (latestAudit.record.blocked) {
    const action = await vscode.window.showErrorMessage(
      `The latest preflight audit ${latestAudit.record.runId} is blocked. ${params.operationLabel} cannot proceed until preflight passes.`,
      "Open Audit Record",
      "Run Preflight"
    );
    if (action === "Open Audit Record") {
      await openLatestAuditRecord();
    }
    if (action === "Run Preflight") {
      await vscode.commands.executeCommand("migrapilot.preflightOperation");
    }
    return undefined;
  }

  if (latestAudit.record.approvalRequired && params.requireApprovalConfirmation) {
    const action = await vscode.window.showWarningMessage(
      `Preflight ${latestAudit.record.runId} requires explicit operator approval for ${params.operationLabel}. Continue?`,
      { modal: true },
      "Proceed",
      "Open Audit Record",
      "Cancel"
    );
    if (action === "Open Audit Record") {
      await openLatestAuditRecord();
    }
    if (action !== "Proceed") {
      return undefined;
    }
  }

  return {
    runId: latestAudit.record.runId,
    claims: {
      preflightRunId: latestAudit.record.runId,
      preflightTimestamp: latestAudit.record.timestamp,
      preflightCommandId: latestAudit.record.commandId,
      preflightApprovalRequired: latestAudit.record.approvalRequired,
      preflightBlocked: latestAudit.record.blocked
    }
  };
}

async function openWorkspaceFile(relativePath: string): Promise<void> {
  const fullPath = getWorkspaceFilePath(relativePath);
  if (!fullPath || !fs.existsSync(fullPath)) {
    vscode.window.showErrorMessage(`MigraPilot could not find ${relativePath} in the workspace.`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(fullPath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

function readWorkspaceJson<T>(relativePath: string): T | undefined {
  const fullPath = getWorkspaceFilePath(relativePath);
  if (!fullPath || !fs.existsSync(fullPath)) {
    return undefined;
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(raw) as T;
}

function getRegistrySummary(): RegistrySummary {
  const commands = readWorkspaceJson<{ commands?: unknown[] }>("registry/commands.json");
  const products = readWorkspaceJson<{ products?: unknown[] }>("registry/products.json");
  const infrastructure = readWorkspaceJson<{ nodes?: unknown[] }>("registry/infrastructure.json");
  const services = readWorkspaceJson<{ services?: unknown[] }>("registry/services.json");
  const incidents = readWorkspaceJson<{ severityLevels?: unknown[] }>("registry/incidents.json");
  const tenants = readWorkspaceJson<{ lifecycleStates?: unknown[] }>("registry/tenants.json");

  return {
    commands: commands?.commands?.length ?? null,
    products: products?.products?.length ?? null,
    infrastructureNodes: infrastructure?.nodes?.length ?? null,
    services: services?.services?.length ?? null,
    incidentSeverities: incidents?.severityLevels?.length ?? null,
    tenantLifecycleStates: tenants?.lifecycleStates?.length ?? null
  };
}

async function openArchitectureNavigator(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "Master Architecture",
        description: "Top-level ecosystem blueprint",
        action: async () => openWorkspaceFile("docs/MIGRATECK_MASTER_ARCHITECTURE.md")
      },
      {
        label: "Platform Autonomy Model",
        description: "Autonomy levels and safety boundaries",
        action: async () => openWorkspaceFile("PLATFORM_AUTONOMY_MODEL.md")
      },
      {
        label: "Incident Operating Model",
        description: "Severity, escalation, and resilience workflow",
        action: async () => openWorkspaceFile("INCIDENT_OPERATING_MODEL.md")
      },
      {
        label: "Tenant Operating Model",
        description: "Tenant lifecycle and resource ownership",
        action: async () => openWorkspaceFile("TENANT_OPERATING_MODEL.md")
      },
      {
        label: "Registry Summary",
        description: "Counts for commands, products, infra, services, incidents, and tenants",
        action: async () => vscode.commands.executeCommand("migrapilot.showWorkspaceRegistrySummary")
      },
      {
        label: "Services Registry JSON",
        description: "Machine-readable service map",
        action: async () => openWorkspaceFile("registry/services.json")
      },
      {
        label: "Commands Registry JSON",
        description: "Machine-readable operational command map",
        action: async () => openWorkspaceFile("registry/commands.json")
      },
      {
        label: "Infrastructure Registry JSON",
        description: "Machine-readable infrastructure node map",
        action: async () => openWorkspaceFile("registry/infrastructure.json")
      },
      {
        label: "Products Registry JSON",
        description: "Machine-readable product map",
        action: async () => openWorkspaceFile("registry/products.json")
      },
      {
        label: "Incidents Registry JSON",
        description: "Machine-readable incident severity and escalation model",
        action: async () => openWorkspaceFile("registry/incidents.json")
      },
      {
        label: "Tenants Registry JSON",
        description: "Machine-readable tenant lifecycle and entitlement model",
        action: async () => openWorkspaceFile("registry/tenants.json")
      }
    ],
    {
      title: "MigraPilot Architecture Navigator",
      placeHolder: "Open an architecture doc or registry source",
      matchOnDescription: true
    }
  );

  if (!picked) {
    return;
  }

  await picked.action();
}

function getServiceRegistry(): ServiceRegistryEntry[] {
  return readWorkspaceJson<{ services?: ServiceRegistryEntry[] }>("registry/services.json")?.services ?? [];
}

function getCommandRegistry(): CommandRegistryEntry[] {
  return readWorkspaceJson<{ commands?: CommandRegistryEntry[] }>("registry/commands.json")?.commands ?? [];
}

function getIncidentRegistry(): IncidentRegistry {
  return readWorkspaceJson<IncidentRegistry>("registry/incidents.json") ?? {};
}

function getTenantRegistry(): TenantRegistry {
  return readWorkspaceJson<TenantRegistry>("registry/tenants.json") ?? {};
}

function getDependencyImpactLabel(service: ServiceRegistryEntry): string {
  const dependencyCount = service.dependencies?.length ?? 0;
  if (service.criticality === "critical" || dependencyCount >= 4) {
    return "high downstream impact";
  }
  if (service.criticality === "high" || dependencyCount >= 2) {
    return "moderate downstream impact";
  }
  return "bounded downstream impact";
}

function formatServiceInspection(service: ServiceRegistryEntry): string {
  return [
    `# ${service.serviceName}`,
    "",
    `product: ${service.product}`,
    `server: ${service.server}`,
    `service_type: ${service.serviceType}`,
    `exposure: ${service.exposure}`,
    `protocols: ${(service.protocols ?? []).join(", ") || "unknown"}`,
    `criticality: ${service.criticality ?? "unknown"}`,
    `managed_by: ${service.managedBy ?? "unknown"}`,
    `dependency_impact: ${getDependencyImpactLabel(service)}`,
    "",
    "## Endpoints",
    ...(service.endpoints?.length ? service.endpoints.map((endpoint) => `- ${endpoint}`) : ["- none recorded"]),
    "",
    "## Healthcheck",
    service.healthcheck ?? "none recorded",
    "",
    "## Dependencies",
    ...(service.dependencies?.length ? service.dependencies.map((dependency) => `- ${dependency}`) : ["- none recorded"]),
    "",
    "## Operational Guidance",
    "- Validate the recorded healthcheck before and after risky changes.",
    "- Check downstream dependencies before restart or failover.",
    service.criticality === "critical"
      ? "- Treat restart, failover, and rollback actions as incident-sensitive for this service."
      : "- Prefer bounded changes and verify customer impact after mutation."
  ].join("\n");
}

function mapIncidentSeverity(service: ServiceRegistryEntry, condition: string): string {
  if (condition === "platform-outage") {
    return "SEV0";
  }
  if (condition === "service-outage") {
    return service.criticality === "critical" ? "SEV1" : "SEV2";
  }
  if (condition === "degraded") {
    return service.criticality === "critical" ? "SEV2" : "SEV3";
  }
  if (condition === "security") {
    return service.criticality === "critical" ? "SEV1" : "SEV2";
  }
  return "SEV4";
}

function mapEscalationLevel(severity: string): string {
  if (severity === "SEV0") {
    return "L4";
  }
  if (severity === "SEV1") {
    return "L3";
  }
  if (severity === "SEV2") {
    return "L2";
  }
  return "L1";
}

function formatIncidentAssessment(
  service: ServiceRegistryEntry,
  conditionLabel: string,
  severity: IncidentSeverityLevel | undefined,
  escalation: IncidentEscalationLevel | undefined,
  allowedAutomations: string[]
): string {
  return [
    `# Incident Assessment: ${service.serviceName}`,
    "",
    `condition: ${conditionLabel}`,
    `service: ${service.serviceName}`,
    `product: ${service.product}`,
    `server: ${service.server}`,
    `criticality: ${service.criticality ?? "unknown"}`,
    `dependency_impact: ${getDependencyImpactLabel(service)}`,
    `recommended_severity: ${severity?.id ?? "unknown"}`,
    `severity_label: ${severity?.name ?? "unknown"}`,
    `recommended_escalation: ${escalation?.id ?? "unknown"}`,
    `escalation_label: ${escalation?.description ?? "unknown"}`,
    "",
    "## Healthcheck",
    service.healthcheck ?? "none recorded",
    "",
    "## Dependencies",
    ...(service.dependencies?.length ? service.dependencies.map((dependency) => `- ${dependency}`) : ["- none recorded"]),
    "",
    "## Immediate Actions",
    ...(severity?.immediateActions?.length ? severity.immediateActions.map((action) => `- ${action}`) : ["- observe and classify before mutation"]),
    "",
    "## Allowed Automations",
    ...(allowedAutomations.length ? allowedAutomations.map((action) => `- ${action}`) : ["- none recorded"]),
    "",
    "## Guidance",
    "- Validate service health before and after any mitigation attempt.",
    "- Check downstream dependency impact before restart, failover, or rollback.",
    severity?.id === "SEV0" || severity?.id === "SEV1"
      ? "- Treat this as an active incident response path and keep a timeline of actions."
      : "- Prefer bounded recovery and continue observation if customer impact is limited."
  ].join("\n");
}

function isTenantAffectingCommand(command: CommandRegistryEntry): boolean {
  return command.id.startsWith("tenant.") || command.product === "MigraPanel" || command.product === "MigraHosting" || command.product === "MigraMail" || command.product === "MigraVoice";
}

function findRelatedServices(command: CommandRegistryEntry, services: ServiceRegistryEntry[]): ServiceRegistryEntry[] {
  const commandHosts = new Set(command.targetHosts ?? []);
  return services.filter((service) => {
    const hostMatch = [...commandHosts].some((host) => host.includes(service.server));
    const productMatch = service.product.includes(command.product) || command.product.includes(service.product);
    return hostMatch || productMatch;
  });
}

function formatPreflightReport(params: {
  runId: string;
  auditPath: string | undefined;
  command: CommandRegistryEntry;
  service: ServiceRegistryEntry | undefined;
  tenantState: string | undefined;
  entitlementMatch: TenantEntitlement | undefined;
  approvalRequired: boolean;
  blocked: boolean;
  reasons: string[];
  validationChecks: string[];
}): string {
  return [
    `# Preflight: ${params.command.id}`,
    "",
    `run_id: ${params.runId}`,
    `audit_record: ${params.auditPath ?? "not written"}`,
    `title: ${params.command.title}`,
    `domain: ${params.command.domain}`,
    `product: ${params.command.product}`,
    `risk_tier: ${params.command.riskTier}`,
    `production_impact: ${params.command.productionImpact ? "yes" : "no"}`,
    `service: ${params.service?.serviceName ?? "none selected"}`,
    `service_criticality: ${params.service?.criticality ?? "unknown"}`,
    `dependency_impact: ${params.service ? getDependencyImpactLabel(params.service) : "unknown"}`,
    `tenant_state: ${params.tenantState ?? "not evaluated"}`,
    `entitlement_match: ${params.entitlementMatch ? `${params.entitlementMatch.product} / ${params.entitlementMatch.capability}` : "none"}`,
    `approval_required: ${params.approvalRequired ? "yes" : "no"}`,
    `execution_status: ${params.blocked ? "blocked" : "preflight-ok"}`,
    "",
    "## Reasons",
    ...(params.reasons.length ? params.reasons.map((reason) => `- ${reason}`) : ["- no issues detected"]),
    "",
    "## Validation Checks",
    ...(params.validationChecks.length ? params.validationChecks.map((check) => `- ${check}`) : ["- none recorded"]),
    "",
    "## Guidance",
    params.blocked
      ? "- Resolve the blocking conditions before execution."
      : "- Execute only after verifying the listed checks and service health.",
    params.approvalRequired
      ? "- This operation should not proceed without explicit approval or operator intent."
      : "- This operation is within the current preflight safety boundary."
  ].join("\n");
}

function getSelectionContext(editor: vscode.TextEditor): {
  filePath: string;
  selectionText: string;
  contextText: string;
  languageId: string;
} {
  const selection = editor.selection;
  const doc = editor.document;
  const startLine = Math.max(0, selection.start.line - 50);
  const endLine = Math.min(doc.lineCount - 1, selection.end.line + 50);
  const contextRange = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);

  return {
    filePath: doc.uri.fsPath,
    selectionText: doc.getText(selection),
    contextText: doc.getText(contextRange),
    languageId: doc.languageId
  };
}

async function openDiff(beforeText: string, afterText: string, languageId: string, title: string): Promise<void> {
  const beforeDoc = await vscode.workspace.openTextDocument({ content: beforeText, language: languageId });
  const afterDoc = await vscode.workspace.openTextDocument({ content: afterText, language: languageId });
  await vscode.commands.executeCommand("vscode.diff", beforeDoc.uri, afterDoc.uri, title);
}

function getLanguageId(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
    css: "css", scss: "scss", html: "html", vue: "vue", svelte: "svelte",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", sh: "shellscript", bash: "shellscript",
    sql: "sql", prisma: "prisma", graphql: "graphql",
    dockerfile: "dockerfile", xml: "xml", cpp: "cpp", c: "c", h: "c",
  };
  return map[ext] ?? "plaintext";
}

async function runRepoCommand(
  kind: "tests" | "build",
  output: vscode.OutputChannel
): Promise<void> {
  const cfg = getBrainClientConfig();
  const client = new BrainClient(cfg);
  const args = kind === "tests" ? ["test"] : ["run", "build"];
  const safetyContext = await getExecutionSafetyContext({
    operationLabel: kind === "tests" ? "run tests" : "run a build",
    requireFreshPreflight: false,
    requireApprovalConfirmation: false
  });

  const response = await client.execute({
    toolName: "repo.run",
    runnerTarget: cfg.runnerTarget,
    environment: cfg.environment,
    operator: {
      ...getOperator(),
      claims: safetyContext?.claims
    },
    runId: safetyContext?.runId,
    toolInput: {
      cmd: "npm",
      args,
      timeoutSec: 300
    }
  });

  output.appendLine(`[${kind}] ${JSON.stringify(response.data?.overlay ?? {}, null, 2)}`);
  const result = response.data?.result;
  output.appendLine(`[${kind}] ok=${String(result?.ok)}`);
  const stdout = result?.data?.stdout;
  const stderr = result?.data?.stderr;
  if (typeof stdout === "string" && stdout.length) {
    output.appendLine(stdout);
  }
  if (typeof stderr === "string" && stderr.length) {
    output.appendLine(stderr);
  }
  if (!result?.ok) {
    throw new Error(result?.error?.message ?? `${kind} failed`);
  }
}

function autoStartBrainEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("migrapilot")
    .get<boolean>("autoStartBrain", true);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startPilotApiTask(output: vscode.OutputChannel): Promise<boolean> {
  const active = vscode.tasks.taskExecutions.find((execution) => execution.task.name === "Start Pilot API");
  if (active) {
    output.appendLine("[brain] Start Pilot API task is already running.");
    return true;
  }

  const tasks = await vscode.tasks.fetchTasks();
  const task = tasks.find((candidate) => candidate.name === "Start Pilot API");
  if (!task) {
    output.appendLine("[brain] Could not find a workspace task named Start Pilot API.");
    return false;
  }

  output.appendLine("[brain] Executing workspace task: Start Pilot API");
  await vscode.tasks.executeTask(task);
  return true;
}

async function waitForBrainReady(output: vscode.OutputChannel, attempts = 15, delayMs = 1000) {
  let last = await probeBrainHealth(getBrainClientConfig(), 2500);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await probeBrainHealth(getBrainClientConfig(), 2500);
    if (last.ok) {
      output.appendLine(`[brain] Connected to ${last.url}`);
      return last;
    }
    await delay(delayMs);
  }
  output.appendLine(`[brain] Still unavailable after waiting: ${last.detail}`);
  return last;
}

function applyBrainStatusBar(statusBar: vscode.StatusBarItem, health: {
  ok: boolean;
  state: "connected" | "starting" | "offline" | "misconfigured";
  detail: string;
  url: string;
}): void {
  if (health.ok) {
    statusBar.text = "$(plug) MigraPilot API";
    statusBar.tooltip = `Connected to ${health.url}`;
    statusBar.color = undefined;
    statusBar.backgroundColor = undefined;
    return;
  }

  if (health.state === "starting") {
    statusBar.text = "$(sync~spin) MigraPilot API";
    statusBar.tooltip = health.detail;
    statusBar.color = undefined;
    statusBar.backgroundColor = undefined;
    return;
  }

  if (health.state === "misconfigured") {
    statusBar.text = "$(error) MigraPilot API";
    statusBar.tooltip = health.detail;
    statusBar.color = new vscode.ThemeColor("statusBarItem.errorForeground");
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    return;
  }

  statusBar.text = "$(warning) MigraPilot API";
  statusBar.tooltip = health.detail;
  statusBar.color = new vscode.ThemeColor("statusBarItem.warningForeground");
  statusBar.backgroundColor = undefined;
}

async function presentBrainError(error: unknown, output: vscode.OutputChannel): Promise<void> {
  const config = getBrainClientConfig();
  const fallback = `MigraPilot could not reach ${config.baseUrl}. Start pilot-api or update migrapilot.brainUrl.`;
  const message = isBrainConnectionError(error)
    ? fallback
    : error instanceof Error
      ? error.message
      : String(error);

  output.appendLine(`[brain error] ${message}`);
  const choice = await vscode.window.showErrorMessage(
    message,
    "Repair Connection",
    "Open Settings",
    "Show Logs"
  );

  if (choice === "Repair Connection") {
    await vscode.commands.executeCommand("migrapilot.repairConnection");
  }
  if (choice === "Open Settings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "migrapilot.brainUrl");
  }
  if (choice === "Show Logs") {
    output.show(true);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("MigraPilot");

  // ── Inline Completions ────────────────────────────────────────────────────

  function completionsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("migrapilot")
      .get<boolean>("completions.enabled", true);
  }

  // Status bar: shows $(migrapilot-logo) state
  const statusBar = vscode.window.createStatusBarItem(
    "migrapilot.completionsStatus",
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = "migrapilot.toggleCompletions";

  function updateStatusBar(status: "idle" | "loading" | "error" = "idle"): void {
    const enabled = completionsEnabled();
    if (!enabled) {
      statusBar.text = "$(circle-slash) MigraPilot";
      statusBar.tooltip = "MigraPilot completions disabled (click to enable)";
      statusBar.color = new vscode.ThemeColor("statusBarItem.warningForeground");
    } else if (status === "loading") {
      statusBar.text = "$(sync~spin) MigraPilot";
      statusBar.tooltip = "MigraPilot: fetching completion…";
      statusBar.color = undefined;
    } else if (status === "error") {
      statusBar.text = "$(warning) MigraPilot";
      statusBar.tooltip = "MigraPilot: last completion request failed";
      statusBar.color = new vscode.ThemeColor("statusBarItem.errorForeground");
    } else {
      statusBar.text = "$(sparkle) MigraPilot";
      statusBar.tooltip = "MigraPilot completions enabled (click to disable)";
      statusBar.color = undefined;
    }
    statusBar.show();
  }

  updateStatusBar();
  context.subscriptions.push(statusBar);

  const brainStatusBar = vscode.window.createStatusBarItem(
    "migrapilot.brainStatus",
    vscode.StatusBarAlignment.Left,
    100
  );
  brainStatusBar.command = "migrapilot.checkHealth";
  brainStatusBar.text = "$(sync~spin) MigraPilot API";
  brainStatusBar.tooltip = "Checking MigraPilot backend health…";
  brainStatusBar.show();
  context.subscriptions.push(brainStatusBar);

  async function refreshBrainStatus(options?: { autoStart?: boolean; notify?: boolean }): Promise<void> {
    let health = await probeBrainHealth(getBrainClientConfig(), 2500);
    applyBrainStatusBar(brainStatusBar, health);

    if (
      !health.ok
      && options?.autoStart
      && autoStartBrainEnabled()
      && health.state === "offline"
      && isLocalBrainUrl(getBrainClientConfig().baseUrl)
    ) {
      const started = await startPilotApiTask(output);
      if (started) {
        applyBrainStatusBar(brainStatusBar, {
          ok: false,
          state: "starting",
          detail: "Starting pilot-api from the workspace task…",
          url: getBrainClientConfig().baseUrl,
        });
        health = await waitForBrainReady(output, 18, 1000);
        applyBrainStatusBar(brainStatusBar, health);
      }
    }

    if (options?.notify) {
      if (health.ok) {
        vscode.window.showInformationMessage(`MigraPilot connected to ${health.url}.`);
      } else {
        vscode.window.showWarningMessage(health.detail, "Repair Connection", "Open Settings").then(async (choice) => {
          if (choice === "Repair Connection") {
            await vscode.commands.executeCommand("migrapilot.repairConnection");
          }
          if (choice === "Open Settings") {
            await vscode.commands.executeCommand("workbench.action.openSettings", "migrapilot.brainUrl");
          }
        });
      }
    }
  }

  const completionProvider = new MigraCompletionProvider();
  context.subscriptions.push(completionProvider);

  context.subscriptions.push(
    completionProvider.onStatusChange.event((status) => updateStatusBar(status))
  );

  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },  // all files; user can narrow via completions.languages config later
    completionProvider
  );
  context.subscriptions.push(completionRegistration);

  // Accept telemetry: log every accepted completion to the output channel
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "editor.action.inlineSuggest.commit",
      async () => {
        output.appendLine(
          `[completions] accepted at ${new Date().toISOString()}`
        );
        await vscode.commands.executeCommand(
          "default:editor.action.inlineSuggest.commit"
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.toggleCompletions", async () => {
      const cfg = vscode.workspace.getConfiguration("migrapilot");
      const current = cfg.get<boolean>("completions.enabled", true);
      await cfg.update(
        "completions.enabled",
        !current,
        vscode.ConfigurationTarget.Global
      );
      updateStatusBar();
      vscode.window.showInformationMessage(
        `MigraPilot completions ${!current ? "enabled" : "disabled"}.`
      );
    })
  );

  // Re-render status bar when user changes setting manually
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("migrapilot.completions.enabled")) {
        updateStatusBar();
      }
      if (
        e.affectsConfiguration("migrapilot.brainUrl")
        || e.affectsConfiguration("migrapilot.authToken")
        || e.affectsConfiguration("migrapilot.autoStartBrain")
      ) {
        void refreshBrainStatus({ autoStart: true });
      }
    })
  );

  const healthTimer = setInterval(() => {
    void refreshBrainStatus({ autoStart: true });
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(healthTimer) });

  void refreshBrainStatus({ autoStart: true });

  // ── Chat + other commands ─────────────────────────────────────────────────
  const chatProvider = new ChatViewProvider(context.extensionUri, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.checkHealth", async () => {
      await refreshBrainStatus({ notify: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.repairConnection", async () => {
      const initial = await probeBrainHealth(getBrainClientConfig(), 2500);
      applyBrainStatusBar(brainStatusBar, initial);

      if (initial.ok) {
        vscode.window.showInformationMessage(`MigraPilot is already connected to ${initial.url}.`);
        return;
      }

      if (initial.state === "misconfigured") {
        await presentBrainError(new Error(initial.detail), output);
        return;
      }

      if (isLocalBrainUrl(getBrainClientConfig().baseUrl)) {
        const started = await startPilotApiTask(output);
        if (started) {
          applyBrainStatusBar(brainStatusBar, {
            ok: false,
            state: "starting",
            detail: "Starting pilot-api from the workspace task…",
            url: getBrainClientConfig().baseUrl,
          });
          const final = await waitForBrainReady(output, 18, 1000);
          applyBrainStatusBar(brainStatusBar, final);
          if (final.ok) {
            vscode.window.showInformationMessage(`MigraPilot connected to ${final.url}.`);
            return;
          }
        }
      }

      await presentBrainError(new Error(initial.detail), output);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.showLogs", async () => {
      output.show(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openChat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.migrapilot");
      chatProvider.reveal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.inspectService", async () => {
      const services = getServiceRegistry();
      if (!services.length) {
        vscode.window.showErrorMessage("MigraPilot could not find any services in registry/services.json.");
        return;
      }

      const picked = await vscode.window.showQuickPick(
        services
          .slice()
          .sort((left, right) => left.serviceName.localeCompare(right.serviceName))
          .map((service) => ({
            label: service.serviceName,
            description: `${service.server} | ${service.criticality ?? "unknown"}`,
            detail: `${service.product} | ${service.exposure} | ${service.healthcheck ?? "no healthcheck recorded"}`,
            service
          })),
        {
          title: "MigraPilot Service Inspector",
          placeHolder: "Select a service from registry/services.json",
          matchOnDescription: true,
          matchOnDetail: true
        }
      );

      if (!picked) {
        return;
      }

      const doc = await vscode.workspace.openTextDocument({
        content: formatServiceInspection(picked.service),
        language: "markdown"
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.assessServiceIncident", async () => {
      const services = getServiceRegistry();
      if (!services.length) {
        vscode.window.showErrorMessage("MigraPilot could not find any services in registry/services.json.");
        return;
      }

      const pickedService = await vscode.window.showQuickPick(
        services
          .slice()
          .sort((left, right) => left.serviceName.localeCompare(right.serviceName))
          .map((service) => ({
            label: service.serviceName,
            description: `${service.server} | ${service.criticality ?? "unknown"}`,
            detail: `${service.product} | ${service.exposure}`,
            service
          })),
        {
          title: "MigraPilot Incident Assessment",
          placeHolder: "Select the affected service",
          matchOnDescription: true,
          matchOnDetail: true
        }
      );

      if (!pickedService) {
        return;
      }

      const pickedCondition = await vscode.window.showQuickPick(
        [
          { label: "Platform outage", value: "platform-outage" },
          { label: "Service outage", value: "service-outage" },
          { label: "Degraded performance", value: "degraded" },
          { label: "Security incident", value: "security" },
          { label: "Informational signal", value: "informational" }
        ],
        {
          title: "Incident condition",
          placeHolder: "Select the current condition"
        }
      );

      if (!pickedCondition) {
        return;
      }

      const incidentRegistry = getIncidentRegistry();
      const severityId = mapIncidentSeverity(pickedService.service, pickedCondition.value);
      const escalationId = mapEscalationLevel(severityId);
      const severity = incidentRegistry.severityLevels?.find((entry) => entry.id === severityId);
      const escalation = incidentRegistry.escalationLevels?.find((entry) => entry.id === escalationId);
      const doc = await vscode.workspace.openTextDocument({
        content: formatIncidentAssessment(
          pickedService.service,
          pickedCondition.label,
          severity,
          escalation,
          incidentRegistry.allowedAutomations ?? []
        ),
        language: "markdown"
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.preflightOperation", async () => {
      const commands = getCommandRegistry();
      if (!commands.length) {
        vscode.window.showErrorMessage("MigraPilot could not find any commands in registry/commands.json.");
        return;
      }

      const services = getServiceRegistry();
      const tenantRegistry = getTenantRegistry();

      const pickedCommand = await vscode.window.showQuickPick(
        commands
          .slice()
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((command) => ({
            label: command.id,
            description: `${command.domain} | ${command.product} | Tier ${command.riskTier}`,
            detail: command.description,
            command
          })),
        {
          title: "MigraPilot Preflight",
          placeHolder: "Select an operation from registry/commands.json",
          matchOnDescription: true,
          matchOnDetail: true
        }
      );

      if (!pickedCommand) {
        return;
      }

      const relatedServices = findRelatedServices(pickedCommand.command, services);
      const pickedService = relatedServices.length
        ? await vscode.window.showQuickPick(
            relatedServices.map((service) => ({
              label: service.serviceName,
              description: `${service.server} | ${service.criticality ?? "unknown"}`,
              detail: `${service.product} | ${service.healthcheck ?? "no healthcheck recorded"}`,
              service
            })),
            {
              title: "Related service",
              placeHolder: "Select the service most directly affected",
              matchOnDescription: true,
              matchOnDetail: true,
              ignoreFocusOut: true
            }
          )
        : undefined;

      const requiresTenantContext = isTenantAffectingCommand(pickedCommand.command);
      let tenantState: string | undefined;
      if (requiresTenantContext) {
        const pickedTenantState = await vscode.window.showQuickPick(
          (tenantRegistry.lifecycleStates ?? []).map((state) => ({ label: state })),
          {
            title: "Tenant lifecycle state",
            placeHolder: "Select the current tenant state",
            ignoreFocusOut: true
          }
        );

        if (!pickedTenantState) {
          return;
        }

        tenantState = pickedTenantState.label;
      }

      const entitlementMatch = (tenantRegistry.entitlements ?? []).find((entitlement) => entitlement.product === pickedCommand.command.product);
      const reasons: string[] = [];
      const validationChecks = [...(tenantRegistry.requiredValidationChecks ?? [])];
      let approvalRequired = pickedCommand.command.riskTier >= 2 || pickedCommand.command.productionImpact;
      let blocked = false;
      const runId = generateRunId();

      if (pickedService?.service.criticality === "critical") {
        approvalRequired = true;
        reasons.push("selected service is critical");
      }

      if (pickedService) {
        reasons.push(`dependency impact is ${getDependencyImpactLabel(pickedService.service)}`);
        if (pickedService.service.healthcheck) {
          validationChecks.push(`service healthcheck: ${pickedService.service.healthcheck}`);
        }
      }

      if (tenantState === "suspended") {
        approvalRequired = true;
        reasons.push("tenant is suspended; only bounded actions should proceed");
      }

      if (tenantState === "terminated") {
        blocked = true;
        reasons.push("tenant is terminated");
      }

      if (requiresTenantContext && !entitlementMatch) {
        blocked = true;
        reasons.push("tenant entitlement does not match the command product");
      }

      if ((pickedCommand.command.targetHosts?.length ?? 0) > 1) {
        reasons.push("command spans multiple potential hosts");
      }

      const auditRecord: PreflightAuditRecord = {
        runId,
        timestamp: new Date().toISOString(),
        commandId: pickedCommand.command.id,
        commandTitle: pickedCommand.command.title,
        domain: pickedCommand.command.domain,
        product: pickedCommand.command.product,
        riskTier: pickedCommand.command.riskTier,
        productionImpact: pickedCommand.command.productionImpact,
        service: pickedService?.service.serviceName,
        serviceCriticality: pickedService?.service.criticality,
        dependencyImpact: pickedService ? getDependencyImpactLabel(pickedService.service) : undefined,
        tenantState,
        entitlementMatch: entitlementMatch ? `${entitlementMatch.product} / ${entitlementMatch.capability}` : undefined,
        approvalRequired,
        blocked,
        reasons,
        validationChecks
      };

      const auditPath = writeAuditRecord(auditRecord);

      const doc = await vscode.workspace.openTextDocument({
        content: formatPreflightReport({
          runId,
          auditPath,
          command: pickedCommand.command,
          service: pickedService?.service,
          tenantState,
          entitlementMatch,
          approvalRequired,
          blocked,
          reasons,
          validationChecks
        }),
        language: "markdown"
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openLatestAuditRecord", async () => {
      await openLatestAuditRecord();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.showWorkspaceRegistrySummary", async () => {
      const summary = getRegistrySummary();
      const content = [
        "MigraPilot Workspace Registry Summary",
        "",
        `commands: ${summary.commands ?? "missing"}`,
        `products: ${summary.products ?? "missing"}`,
        `infrastructure nodes: ${summary.infrastructureNodes ?? "missing"}`,
        `services: ${summary.services ?? "missing"}`,
        `incident severity levels: ${summary.incidentSeverities ?? "missing"}`,
        `tenant lifecycle states: ${summary.tenantLifecycleStates ?? "missing"}`
      ].join("\n");

      const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openArchitectureNavigator", async () => {
      await openArchitectureNavigator();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openMasterArchitecture", async () => {
      await openWorkspaceFile("docs/MIGRATECK_MASTER_ARCHITECTURE.md");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openIncidentModel", async () => {
      await openWorkspaceFile("INCIDENT_OPERATING_MODEL.md");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openPlatformAutonomyModel", async () => {
      await openWorkspaceFile("PLATFORM_AUTONOMY_MODEL.md");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.openTenantModel", async () => {
      await openWorkspaceFile("TENANT_OPERATING_MODEL.md");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.setAuthToken", async () => {
      const current = vscode.workspace.getConfiguration("migrapilot").get<string>("authToken", "");
      const token = await vscode.window.showInputBox({
        prompt: "Set MigraPilot bearer token",
        placeHolder: "Paste a JWT for pilot-api access",
        password: true,
        value: current,
        ignoreFocusOut: true
      });

      if (token === undefined) {
        return;
      }

      await vscode.workspace.getConfiguration("migrapilot").update(
        "authToken",
        token.trim(),
        vscode.ConfigurationTarget.Global
      );

      vscode.window.showInformationMessage("MigraPilot auth token updated.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.clearAuthToken", async () => {
      await vscode.workspace.getConfiguration("migrapilot").update(
        "authToken",
        "",
        vscode.ConfigurationTarget.Global
      );

      vscode.window.showInformationMessage("MigraPilot auth token cleared.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.explainSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const ctx = getSelectionContext(editor);
      const client = new BrainClient(getBrainClientConfig());
      const prompt = [
        `Explain this selection in ${ctx.filePath}.`,
        "Selection:",
        ctx.selectionText,
        "Context:",
        ctx.contextText
      ].join("\n");

      try {
        const response = await client.chat(prompt);
        const content = response?.data?.assistant?.content ?? "No response";
        const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error) {
        await presentBrainError(error, output);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.fixSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const ctx = getSelectionContext(editor);
      const client = new BrainClient(getBrainClientConfig());
      const prompt = [
        `Suggest a fix for this selection in ${ctx.filePath}.`,
        "Selection:",
        ctx.selectionText,
        "Context:",
        ctx.contextText,
        "Return a concise plan and patch strategy."
      ].join("\n");

      try {
        const response = await client.chat(prompt);
        const content = response?.data?.assistant?.content ?? "No response";
        output.appendLine(content);
        vscode.window.showInformationMessage("MigraPilot fix suggestion sent to output panel.");
        output.show(true);
      } catch (error) {
        await presentBrainError(error, output);
      }
    })
  );

  // ── Inline Edit: Cmd+I style ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.inlineEdit", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      if (editor.selection.isEmpty) {
        vscode.window.showWarningMessage("Select some code first, then invoke Inline Edit.");
        return;
      }

      const instruction = await vscode.window.showInputBox({
        prompt: "How should MigraPilot modify this selection?",
        placeHolder: "e.g. Add error handling, convert to async/await, add TypeScript types…"
      });
      if (!instruction?.trim()) return;

      const ctx = getSelectionContext(editor);
      const client = new BrainClient(getBrainClientConfig());

      const prompt = [
        `You are an expert code editor. Modify the selected code according to the instruction below.`,
        `Return ONLY the replacement code — no explanations, no markdown fences, no commentary.`,
        `Match the existing indentation and style exactly.`,
        "",
        `File: ${ctx.filePath} (${ctx.languageId})`,
        "",
        `=== SELECTED CODE ===`,
        ctx.selectionText,
        `=== END SELECTED CODE ===`,
        "",
        `=== SURROUNDING CONTEXT ===`,
        ctx.contextText,
        `=== END CONTEXT ===`,
        "",
        `Instruction: ${instruction.trim()}`,
        "",
        `Modified code:`
      ].join("\n");

      const statusBarMsg = vscode.window.setStatusBarMessage("$(sync~spin) MigraPilot: Editing…");

      try {
        const response = await client.chat(prompt);
        const replacement = response?.data?.assistant?.content ?? "";
        statusBarMsg.dispose();

        if (!replacement.trim()) {
          vscode.window.showWarningMessage("MigraPilot returned an empty response.");
          return;
        }

        // Strip any accidental markdown fences
        const cleaned = replacement.trim().replace(/^```[\w]*\n?/, "").replace(/\n?```\s*$/, "");

        // Show diff before applying
        const beforeText = ctx.selectionText;
        await openDiff(beforeText, cleaned, ctx.languageId, `MigraPilot Inline Edit: ${instruction.trim().slice(0, 40)}`);

        const apply = await vscode.window.showInformationMessage(
          "Apply this edit?",
          { modal: false },
          "Apply",
          "Discard"
        );

        if (apply === "Apply") {
          await editor.edit(editBuilder => {
            editBuilder.replace(editor.selection, cleaned);
          });
          vscode.window.showInformationMessage("Edit applied.");
        }
      } catch (err: any) {
        statusBarMsg.dispose();
        vscode.window.showErrorMessage(`Inline edit failed: ${err.message}`);
      }
    })
  );

  // ── Terminal Context: Send terminal output to chat ────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.sendTerminalToChat", async () => {
      // Get the most recent terminal content via clipboard workaround
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        vscode.window.showWarningMessage("No active terminal.");
        return;
      }

      // Use VS Code's "workbench.action.terminal.selectAll" + copy as a fallback
      // But the cleanest approach is vscode.env.clipboard after selectAll+copy
      await vscode.commands.executeCommand("workbench.action.terminal.selectAll");
      await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
      const terminalContent = await vscode.env.clipboard.readText();

      if (!terminalContent?.trim()) {
        vscode.window.showWarningMessage("Terminal appears empty.");
        return;
      }

      // Truncate to last 200 lines
      const lines = terminalContent.split("\n");
      const recent = lines.slice(-200).join("\n");

      // Send to chat
      chatProvider.reveal();
      chatProvider.sendToChat(
        `Here is my recent terminal output. Help me understand any errors or issues:\n\n\`\`\`\n${recent}\n\`\`\``
      );
    })
  );

  // ── @workspace Search ─────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.searchWorkspace", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Search your workspace codebase",
        placeHolder: "e.g. authentication middleware, database connection, error handling…"
      });
      if (!query?.trim()) return;

      chatProvider.reveal();
      chatProvider.sendToChat(`@workspace ${query.trim()}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.suggestPatchForFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const instruction = await vscode.window.showInputBox({
        prompt: "Describe the patch you want",
        placeHolder: "Fix overflow in header on mobile"
      });
      if (!instruction?.trim()) {
        return;
      }

      const cfg = getBrainClientConfig();
      const client = new BrainClient(cfg);
      const doc = editor.document;
      const beforeText = doc.getText();
      const filePath = doc.uri.fsPath;

      const started = await client.missionStart({
        goal: `Modify ${filePath} to implement: ${instruction.trim()}. Use repo tools.`,
        context: {
          focusFile: filePath,
          notes: "Requested from VS Code extension"
        },
        runnerPolicy: {
          default: "local",
          allowServer: false
        },
        environment: cfg.environment,
        operator: getOperator()
      });

      const missionId = started?.data?.missionId as string;
      if (!missionId) {
        throw new Error("Mission start failed");
      }

      for (let i = 0; i < 2; i += 1) {
        await client.missionStep({ missionId, maxTasks: 2 });
      }

      const report = await client.missionReport(missionId);
      output.appendLine(`[mission ${missionId}] ${report?.data?.summary ?? "no summary"}`);

      const bytes = await vscode.workspace.fs.readFile(doc.uri);
      const afterText = Buffer.from(bytes).toString("utf8");

      if (beforeText === afterText) {
        vscode.window.showWarningMessage("No file changes detected yet. Check mission/report in console.");
      } else {
        await openDiff(beforeText, afterText, doc.languageId, `MigraPilot Patch Preview: ${doc.fileName}`);
      }

      const state: LastPatchState = {
        missionId,
        filePath,
        beforeText,
        afterText,
        appliedByMission: true
      };
      await context.globalState.update(LAST_PATCH_KEY, state);
      vscode.window.showInformationMessage(`Mission ${missionId} completed. Diff opened.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.applyPatch", async () => {
      const state = context.globalState.get<LastPatchState>(LAST_PATCH_KEY);
      if (!state) {
        vscode.window.showErrorMessage("No patch context found. Run Suggest Patch For File first.");
        return;
      }

      const uri = vscode.Uri.file(state.filePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const current = Buffer.from(bytes).toString("utf8");

      if (state.appliedByMission) {
        await openDiff(state.beforeText, current, "plaintext", `MigraPilot Applied Patch: ${state.filePath}`);
        vscode.window.showInformationMessage(`Patch already applied by mission ${state.missionId}.`);
        return;
      }

      if (!state.patch) {
        vscode.window.showWarningMessage("No patch payload available to apply.");
        return;
      }

      const cfg = getBrainClientConfig();
      const requireFreshPreflight = shouldRequirePreflightForRemoteWrites()
        && (cfg.runnerTarget === "server" || cfg.environment === "prod");
      const safetyContext = await getExecutionSafetyContext({
        operationLabel: "apply a patch through the Brain API",
        requireFreshPreflight,
        requireApprovalConfirmation: requireFreshPreflight
      });
      if (requireFreshPreflight && !safetyContext) {
        return;
      }

      const client = new BrainClient(cfg);
      await client.execute({
        toolName: "repo.applyPatch",
        toolInput: {
          patch: state.patch,
          idempotencyKey: `vscode-${Date.now()}`
        },
        operator: {
          ...getOperator(),
          claims: safetyContext?.claims
        },
        runId: safetyContext?.runId
      });

      const updated = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      await openDiff(state.beforeText, updated, "plaintext", `MigraPilot Patch Applied: ${state.filePath}`);
      vscode.window.showInformationMessage("Patch apply requested via Brain API.");
    })
  );

  // ── Multi-file Diff Review ──────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.reviewChanges", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders?.length) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      const cwd = workspaceFolders[0].uri.fsPath;
      const cp = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(cp.execFile);

      try {
        // Get list of changed files (staged + unstaged)
        const { stdout: diffNames } = await execAsync("git", ["diff", "--name-only", "HEAD"], { cwd, timeout: 10000 });
        const { stdout: stagedNames } = await execAsync("git", ["diff", "--name-only", "--cached"], { cwd, timeout: 10000 });

        const allFiles = new Set<string>();
        for (const f of diffNames.split("\n").filter(Boolean)) allFiles.add(f);
        for (const f of stagedNames.split("\n").filter(Boolean)) allFiles.add(f);

        // Also include untracked files
        const { stdout: untrackedNames } = await execAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, timeout: 10000 });
        const untracked = new Set<string>();
        for (const f of untrackedNames.split("\n").filter(Boolean)) untracked.add(f);

        if (allFiles.size === 0 && untracked.size === 0) {
          vscode.window.showInformationMessage("No changes detected in the workspace.");
          return;
        }

        // Build quick pick items
        const items: vscode.QuickPickItem[] = [];
        for (const f of allFiles) {
          items.push({ label: `$(diff) ${f}`, description: "modified", detail: f });
        }
        for (const f of untracked) {
          if (!allFiles.has(f)) {
            items.push({ label: `$(file-add) ${f}`, description: "new file", detail: f });
          }
        }

        const allItem: vscode.QuickPickItem = {
          label: `$(git-compare) Review All ${allFiles.size + untracked.size} Changes`,
          description: `${allFiles.size} modified, ${untracked.size} new`,
          detail: "__ALL__"
        };

        const picked = await vscode.window.showQuickPick(
          [allItem, ...items],
          {
            title: `MigraPilot: Review Changes (${allFiles.size + untracked.size} files)`,
            placeHolder: "Select a file to view diff, or review all",
            canPickMany: false
          }
        );

        if (!picked) return;

        const filesToShow = picked.detail === "__ALL__"
          ? [...allFiles, ...untracked].filter((v, i, a) => a.indexOf(v) === i)
          : [picked.detail!];

        for (const file of filesToShow) {
          const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, file);

          if (untracked.has(file) && !allFiles.has(file)) {
            // New file — show it directly
            await vscode.window.showTextDocument(fileUri, { preview: false });
          } else {
            // Modified file — show git diff
            const gitUri = vscode.Uri.parse(`git-original:${file}`);
            try {
              // Use VS Code's built-in git extension for the original
              const { stdout: original } = await execAsync("git", ["show", `HEAD:${file}`], { cwd, timeout: 10000 });
              const beforeDoc = await vscode.workspace.openTextDocument({ content: original, language: getLanguageId(file) });
              await vscode.commands.executeCommand("vscode.diff", beforeDoc.uri, fileUri, `${file} (HEAD ↔ Working)`);
            } catch {
              // File might be newly added to git, just open it
              await vscode.window.showTextDocument(fileUri, { preview: false });
            }
          }
        }

        if (filesToShow.length > 1) {
          vscode.window.showInformationMessage(`Opened diffs for ${filesToShow.length} files.`);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Review changes failed: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.runTests", async () => {
      try {
        await runRepoCommand("tests", output);
        vscode.window.showInformationMessage("Tests completed.");
      } catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.runBuild", async () => {
      try {
        await runRepoCommand("build", output);
        vscode.window.showInformationMessage("Build completed.");
      } catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
      }
    })
  );

  // ── Usage Dashboard ───────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.showUsageDashboard", async () => {
      const panel = vscode.window.createWebviewPanel(
        "migrapilot.usageDashboard",
        "MigraPilot Usage Dashboard",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      const cfg = getBrainClientConfig();
      const client = new BrainClient(cfg);

      async function refresh() {
        try {
          const base = cfg.baseUrl.replace(/\/$/, "");
          const headers: Record<string, string> = { "content-type": "application/json" };
          const authorization = getAuthorizationHeader(cfg);
          if (authorization) headers["authorization"] = authorization;

          const resp = await fetch(`${base}/api/pilot/usage/dashboard`, { headers });
          const data: any = await resp.json();

          if (!data?.ok) throw new Error(data?.error ?? "Unknown error");

          panel.webview.html = renderDashboard(data.data);
        } catch (err: any) {
          panel.webview.html = `<html><body style="color:#ccc;padding:24px;font-family:sans-serif"><h2>Error loading dashboard</h2><p>${err.message}</p></body></html>`;
        }
      }

      refresh();

      // Auto-refresh every 30s
      const interval = setInterval(refresh, 30000);
      panel.onDidDispose(() => clearInterval(interval));
    })
  );
}

function renderDashboard(d: any): string {
  const live = d.live ?? {};
  const today = d.today ?? {};
  const week = d.week ?? {};
  const month = d.month ?? {};
  const quality = d.quality ?? {};
  const latency = quality.latencyMs ?? {};
  const tooling = quality.tooling ?? {};
  const behavior = quality.behavior ?? {};
  const topTools = d.topTools ?? [];
  const models = d.modelBreakdown ?? [];
  const recent = d.recentConversations ?? [];

  const formatTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  const formatCost = (n: number) => `$${n.toFixed(4)}`;
  const formatMs = (n: number) => `${Math.max(0, Math.round(n || 0))}ms`;
  const formatPct = (n: number) => `${((n || 0) * 100).toFixed(1)}%`;

  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family, 'Segoe UI', sans-serif); color: #ccc; background: #1e1e1e; padding: 16px; margin: 0; }
  h1 { color: #4ec9b0; font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #888; font-size: 12px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #252526; border-radius: 8px; padding: 14px 16px; border: 1px solid #333; }
  .card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
  .card .value.green { color: #4ec9b0; }
  .card .value.blue { color: #569cd6; }
  .card .value.orange { color: #ce9178; }
  .card .value.purple { color: #c586c0; }
  h2 { font-size: 14px; color: #ddd; margin: 20px 0 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #888; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid #333; }
  td { padding: 6px 8px; border-bottom: 1px solid #2a2a2a; }
  .bar { height: 6px; background: #569cd6; border-radius: 3px; min-width: 2px; }
  .bar-cell { width: 100px; }
</style>
</head>
<body>
  <h1>&#x1F4CA; MigraPilot Usage Dashboard</h1>
  <p class="subtitle">Live session: ${live.date || "N/A"} &mdash; Auto-refreshes every 30s</p>

  <div class="cards">
    <div class="card">
      <div class="label">Today Spend (Live)</div>
      <div class="value green">${formatCost(live.totalCost || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Today Runs</div>
      <div class="value blue">${today.runs || 0}</div>
    </div>
    <div class="card">
      <div class="label">Today Tokens</div>
      <div class="value">${formatTokens(today.totalTokens || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Week Runs</div>
      <div class="value blue">${week.runs || 0}</div>
    </div>
    <div class="card">
      <div class="label">Week Tokens</div>
      <div class="value">${formatTokens((week.inputTokens || 0) + (week.outputTokens || 0))}</div>
    </div>
    <div class="card">
      <div class="label">30d Est. Cost</div>
      <div class="value orange">${formatCost(month.estimatedCost || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Total Conversations</div>
      <div class="value purple">${d.totalConversations || 0}</div>
    </div>
    <div class="card">
      <div class="label">30d Runs</div>
      <div class="value">${month.runs || 0}</div>
    </div>
    <div class="card">
      <div class="label">Latency P50 (30d)</div>
      <div class="value blue">${formatMs(latency.p50 || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Latency P95 (30d)</div>
      <div class="value orange">${formatMs(latency.p95 || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Tool-Use Rate (30d)</div>
      <div class="value purple">${formatPct(tooling.toolUseRate || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Clarification Rate (30d)</div>
      <div class="value">${formatPct(behavior.clarificationRate || 0)}</div>
    </div>
  </div>

  <h2>Quality KPIs (30 days)</h2>
  <table>
    <tr><th>Metric</th><th>Value</th><th>Notes</th></tr>
    <tr><td>Latency Avg</td><td>${formatMs(latency.avg || 0)}</td><td>Sample size: ${latency.sampleSize || 0} completed runs</td></tr>
    <tr><td>Runs with Tools</td><td>${tooling.runsWithTools || 0} / ${tooling.runCount || 0}</td><td>Total tool calls: ${tooling.toolCalls || 0}</td></tr>
    <tr><td>Avg Tools / Run</td><td>${Number(tooling.avgToolsPerRun || 0).toFixed(2)}</td><td>Across all 30d runs</td></tr>
    <tr><td>Clarification Count</td><td>${behavior.clarificationCount || 0}</td><td>Assistant messages: ${behavior.assistantMessages || 0}</td></tr>
    <tr><td>No-Speculation Guard Hits</td><td>${behavior.noSpeculationGuardHits || 0}</td><td>Detected safe fallback phrases</td></tr>
    <tr><td>Hard Guard Signals</td><td>${behavior.hardGuardHits || 0}</td><td>Failed tool results with guard-like errors</td></tr>
  </table>

  <h2>Live Session Tokens (by Provider)</h2>
  <div class="cards">
    <div class="card">
      <div class="label">Haiku In/Out</div>
      <div class="value blue">${formatTokens(live.haikuTokens?.input || 0)} / ${formatTokens(live.haikuTokens?.output || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Sonnet In/Out</div>
      <div class="value orange">${formatTokens(live.sonnetTokens?.input || 0)} / ${formatTokens(live.sonnetTokens?.output || 0)}</div>
    </div>
    <div class="card">
      <div class="label">Opus In/Out</div>
      <div class="value purple">${formatTokens(live.opusTokens?.input || 0)} / ${formatTokens(live.opusTokens?.output || 0)}</div>
    </div>
  </div>

  <h2>Model Breakdown (30 days)</h2>
  <table>
    <tr><th>Model</th><th>Runs</th><th>Input</th><th>Output</th><th>Est. Cost</th></tr>
    ${models.map((m: any) => `<tr><td>${m.model}</td><td>${m.runs}</td><td>${formatTokens(m.inputTokens)}</td><td>${formatTokens(m.outputTokens)}</td><td>${formatCost(m.estimatedCost)}</td></tr>`).join("")}
    ${models.length === 0 ? "<tr><td colspan='5' style='color:#666'>No data yet</td></tr>" : ""}
  </table>

  <h2>Top Tools (30 days)</h2>
  <table>
    <tr><th>Tool</th><th>Calls</th><th class="bar-cell">Usage</th></tr>
    ${topTools.map((t: any) => {
      const maxCount = topTools[0]?.count || 1;
      const pct = Math.round((t.count / maxCount) * 100);
      return `<tr><td>${t.name}</td><td>${t.count}</td><td class="bar-cell"><div class="bar" style="width:${pct}%"></div></td></tr>`;
    }).join("")}
    ${topTools.length === 0 ? "<tr><td colspan='3' style='color:#666'>No data yet</td></tr>" : ""}
  </table>

  <h2>Recent Conversations</h2>
  <table>
    <tr><th>Title</th><th>Runs</th><th>Updated</th></tr>
    ${recent.map((c: any) => `<tr><td>${c.title || c.id.slice(0, 8)}</td><td>${c.runCount}</td><td>${new Date(c.updatedAt).toLocaleString()}</td></tr>`).join("")}
    ${recent.length === 0 ? "<tr><td colspan='3' style='color:#666'>No conversations yet</td></tr>" : ""}
  </table>
</body>
</html>`;
}

export function deactivate(): void {
  // no-op
}
