import { executeViaBrainApi } from "../../mission/execute-api";
import { createFinding } from "../finding";
import { TEMPLATE_CLASSIFICATION_DRIFT, TEMPLATE_POD_RESTART_INVESTIGATE } from "../templates";
import type { Classification, Finding, ObserverContext } from "../types";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asClassification(value: unknown): Classification | null {
  return value === "internal" || value === "client" ? value : null;
}

function isInternalDomain(domain: string): boolean {
  return domain.endsWith("migrahosting.com") || domain.endsWith("migrateck.com") || domain.includes("migra");
}

export async function inventoryObserver(context: ObserverContext): Promise<Finding[]> {
  if (!context.config.runnerPolicy.allowServer) {
    return [];
  }

  const findings: Finding[] = [];
  const env = context.config.environmentPolicy.defaultEnv;
  const runIdBase = `autonomy_inventory_${context.now.getTime()}`;

  const topology = await executeViaBrainApi({
    runnerTarget: "server",
    toolName: "inventory.services.topology",
    toolInput: {
      filter: {
        classification: "internal",
        limit: 500
      }
    },
    environment: env,
    operator: {
      operatorId: "autonomy-observer",
      role: "ops"
    },
    runId: `${runIdBase}_topology`,
    autonomyBudgetId: "autonomy-observe"
  });

  if (!topology.result?.ok) {
    findings.push(
      createFinding({
        source: "inventory",
        severity: "warn",
        title: "Inventory observer could not load service topology",
        details: topology.result?.error?.message ?? "inventory.services.topology failed",
        classification: "internal",
        suggestedMissionTemplateId: TEMPLATE_CLASSIFICATION_DRIFT
      })
    );
    return findings;
  }

  const topologyData = asRecord(topology.result.data);
  const services = asItems(topologyData.services);
  if (services.length === 0) {
    findings.push(
      createFinding({
        source: "inventory",
        severity: "critical",
        title: "No internal services found in topology",
        details: "inventory.services.topology returned zero internal services",
        classification: "internal",
        suggestedMissionTemplateId: TEMPLATE_CLASSIFICATION_DRIFT
      })
    );
  }

  const tenantsResult = await executeViaBrainApi({
    runnerTarget: "server",
    toolName: "inventory.tenants.list",
    toolInput: { filter: { limit: 500, offset: 0 } },
    environment: env,
    operator: {
      operatorId: "autonomy-observer",
      role: "ops"
    },
    runId: `${runIdBase}_tenants`,
    autonomyBudgetId: "autonomy-observe"
  });

  const podsResult = await executeViaBrainApi({
    runnerTarget: "server",
    toolName: "inventory.pods.list",
    toolInput: { filter: { limit: 500, offset: 0 } },
    environment: env,
    operator: {
      operatorId: "autonomy-observer",
      role: "ops"
    },
    runId: `${runIdBase}_pods`,
    autonomyBudgetId: "autonomy-observe"
  });

  const domainsResult = await executeViaBrainApi({
    runnerTarget: "server",
    toolName: "inventory.domains.map",
    toolInput: { filter: { limit: 500, offset: 0 } },
    environment: env,
    operator: {
      operatorId: "autonomy-observer",
      role: "ops"
    },
    runId: `${runIdBase}_domains`,
    autonomyBudgetId: "autonomy-observe"
  });

  const tenants = tenantsResult.result?.ok ? asItems(asRecord(tenantsResult.result.data).items) : [];
  const pods = podsResult.result?.ok ? asItems(asRecord(podsResult.result.data).items) : [];
  const domains = domainsResult.result?.ok ? asItems(asRecord(domainsResult.result.data).items) : [];

  const tenantClassification = new Map<string, Classification>();
  for (const tenant of tenants) {
    const tenantId = asString(tenant.tenantId);
    const classification = asClassification(tenant.classification);
    if (tenantId && classification) {
      tenantClassification.set(tenantId, classification);
    }
  }

  const unhealthyPods = pods.filter((pod) => {
    const status = asString(pod.status)?.toLowerCase();
    return status ? !["running", "healthy", "ready"].includes(status) : false;
  });

  for (const pod of unhealthyPods.slice(0, 10)) {
    findings.push(
      createFinding({
        source: "inventory",
        severity: "warn",
        title: `Pod ${asString(pod.podId) ?? "unknown"} is not healthy`,
        details: `status=${asString(pod.status) ?? "unknown"}`,
        classification: asClassification(pod.classification) ?? "client",
        tenantId: asString(pod.tenantId) ?? undefined,
        suggestedMissionTemplateId: TEMPLATE_POD_RESTART_INVESTIGATE
      })
    );
  }

  for (const pod of pods) {
    const tenantId = asString(pod.tenantId);
    const podClassification = asClassification(pod.classification);
    if (!tenantId || !podClassification) {
      continue;
    }
    const tenantClass = tenantClassification.get(tenantId);
    if (tenantClass && tenantClass !== podClassification) {
      findings.push(
        createFinding({
          source: "inventory",
          severity: "critical",
          title: `Classification mismatch for pod ${asString(pod.podId) ?? "unknown"}`,
          details: `tenant=${tenantId} tenantClass=${tenantClass} podClass=${podClassification}`,
          classification: podClassification,
          tenantId,
          suggestedMissionTemplateId: TEMPLATE_CLASSIFICATION_DRIFT
        })
      );
    }
  }

  for (const domain of domains) {
    const fqdn = asString(domain.domain);
    if (!fqdn) {
      continue;
    }
    const domainClass = asClassification(domain.classification);
    const tenantId = asString(domain.tenantId);
    const tenantClass = tenantId ? tenantClassification.get(tenantId) : null;

    if (tenantClass && domainClass && tenantClass !== domainClass) {
      findings.push(
        createFinding({
          source: "inventory",
          severity: "critical",
          title: `Domain classification mismatch for ${fqdn}`,
          details: `tenant=${tenantId ?? "unknown"} tenantClass=${tenantClass} domainClass=${domainClass}`,
          classification: domainClass,
          tenantId: tenantId ?? undefined,
          suggestedMissionTemplateId: TEMPLATE_CLASSIFICATION_DRIFT
        })
      );
      continue;
    }

    if (domainClass === "client" && isInternalDomain(fqdn)) {
      findings.push(
        createFinding({
          source: "inventory",
          severity: "warn",
          title: `Client resource linked to internal domain ${fqdn}`,
          details: `domain=${fqdn} classification=client`,
          classification: "client",
          tenantId: tenantId ?? undefined,
          suggestedMissionTemplateId: TEMPLATE_CLASSIFICATION_DRIFT
        })
      );
    }
  }

  return findings;
}
