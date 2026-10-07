"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  FileLock2,
  Gauge,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
} from "lucide-react";

type Authority = {
  roles: string[];
  permissions: string[];
  viaBootstrap: boolean;
  operatorId: string;
  canManage: boolean;
  canManageRetention: boolean;
};

type RetentionExecution = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  recordsAffected: number;
  error: string | null;
};

type RetentionPolicy = {
  id: string;
  entityType: string;
  retentionDays: number;
  action: "DELETE" | "ANONYMIZE";
  isActive: boolean;
  scope: "PLATFORM" | "ORGANIZATION";
  orgId: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  executions: RetentionExecution[];
};

type AuditRule = {
  id: string;
  name: string;
  description: string | null;
  entityType: string;
  minRetentionDays: number;
  preventDeletion: boolean;
  preventModification: boolean;
  requireApproval: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Runbook = {
  id: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  version: number;
  isPublished: boolean;
  lastReviewAt: string | null;
  nextReviewAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  incidentCount: number;
  createdAt: string;
  updatedAt: string;
};

type Incident = {
  id: string;
  orgId: string | null;
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3" | "SEV4";
  status:
    | "OPEN"
    | "INVESTIGATING"
    | "MITIGATED"
    | "RESOLVED"
    | "POST_MORTEM"
    | "CLOSED";
  runbookId: string | null;
  runbookTitle: string | null;
  description: string | null;
  impact: string | null;
  rootCause: string | null;
  timeline: Array<Record<string, unknown>> | null;
  mitigationSteps: string | null;
  postMortemUrl: string | null;
  reportedByName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  orgName: string | null;
  orgSlug: string | null;
  detectedAt: string;
  mitigatedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type GovernancePayload = {
  authority: Authority;
  retention: {
    policies: RetentionPolicy[];
    rules: AuditRule[];
    supportedEntities: Array<{
      entityType: string;
      actions: Array<"DELETE" | "ANONYMIZE">;
    }>;
    execution: {
      batchLimit: number;
      archiveReady: boolean;
    };
  };
  runbooks: Runbook[];
  incidents: Incident[];
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    isPlatformInternal: boolean;
  }>;
  incidentTransitions: Record<Incident["status"], Incident["status"][]>;
  metrics: {
    activeIncidents: number;
    sev1Active: number;
    sev2Active: number;
    dueRunbooks: number;
    activeRetentionPolicies: number;
    activeAuditRules: number;
  };
  incidentSummary: Record<string, number>;
};

type RetentionPreview = {
  policy: RetentionPolicy;
  cutoff: string;
  eligibleRecords: number;
  batchLimit: number;
  rules: AuditRule[];
};

const INCIDENT_SEVERITIES: Incident["severity"][] = [
  "SEV1",
  "SEV2",
  "SEV3",
  "SEV4",
];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function severityClass(severity: string) {
  if (severity === "SEV1") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "SEV2") return "border-orange-200 bg-orange-50 text-orange-800";
  if (severity === "SEV3") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function statusClass(status: string) {
  if (status === "CLOSED" || status === "RESOLVED") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (status === "INVESTIGATING" || status === "POST_MORTEM") {
    return "bg-blue-50 text-blue-700";
  }
  if (status === "MITIGATED") return "bg-violet-50 text-violet-700";
  return "bg-amber-50 text-amber-700";
}

function slugFromTitle(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(
    "/api/platform/compliance/governance" + path,
    {
      ...options,
      cache: "no-store",
      headers,
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? body.message ?? "Compliance operation failed.");
  }
  return body as T;
}

export function ComplianceGovernanceWorkspace() {
  const [data, setData] = useState<GovernancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [incidentDraft, setIncidentDraft] = useState({
    title: "",
    severity: "SEV2" as Incident["severity"],
    orgId: "",
    runbookId: "",
    description: "",
    impact: "",
    assignToSelf: true,
  });
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [incidentEdits, setIncidentEdits] = useState<
    Record<
      string,
      {
        status: Incident["status"];
        severity: Incident["severity"];
        runbookId: string;
        impact: string;
        rootCause: string;
        mitigationSteps: string;
        postMortemUrl: string;
        note: string;
        assignment: "KEEP" | "SELF" | "UNASSIGN";
      }
    >
  >({});
  const [incidentBusyId, setIncidentBusyId] = useState<string | null>(null);

  const [runbookDraft, setRunbookDraft] = useState({
    title: "",
    slug: "",
    category: "incident",
    content:
      "# Purpose\n\nDescribe the trigger and objective.\n\n# Response\n\n1. Validate the signal.\n2. Contain impact.\n3. Preserve evidence.\n4. Recover and verify.\n\n# Closeout\n\nDocument root cause and follow-up actions.",
  });
  const [runbookSaving, setRunbookSaving] = useState(false);
  const [runbookEditingId, setRunbookEditingId] = useState<string | null>(null);
  const [runbookBusyId, setRunbookBusyId] = useState<string | null>(null);

  const [ruleDraft, setRuleDraft] = useState({
    name: "Audit evidence minimum",
    entityType: "AuditLog",
    minRetentionDays: 365,
    description: "Preserve governed audit evidence for at least one year.",
    preventDeletion: true,
    preventModification: true,
    requireApproval: false,
    isActive: true,
  });
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleEditingId, setRuleEditingId] = useState<string | null>(null);

  const [policyDraft, setPolicyDraft] = useState({
    entityType: "SecurityEvent",
    retentionDays: 365,
    action: "DELETE" as "DELETE" | "ANONYMIZE",
    scope: "PLATFORM" as "PLATFORM" | "ORGANIZATION",
    orgId: "",
    description: "",
    isActive: true,
  });
  const [policySaving, setPolicySaving] = useState(false);
  const [policyEditingId, setPolicyEditingId] = useState<string | null>(null);

  const [previews, setPreviews] = useState<Record<string, RetentionPreview>>({});
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [executeBusyId, setExecuteBusyId] = useState<string | null>(null);
  const [executionInputs, setExecutionInputs] = useState<
    Record<string, { confirm: string; reason: string }>
  >({});

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/compliance/governance", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load governance controls.");
      }
      setData(body);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load governance controls.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runbookMap = useMemo(
    () => new Map(data?.runbooks.map((runbook) => [runbook.id, runbook]) ?? []),
    [data],
  );

  const organizationMap = useMemo(
    () =>
      new Map(
        data?.organizations.map((organization) => [
          organization.id,
          organization,
        ]) ?? [],
      ),
    [data],
  );

  function incidentEdit(incident: Incident) {
    return (
      incidentEdits[incident.id] ?? {
        status: incident.status,
        severity: incident.severity,
        runbookId: incident.runbookId ?? "",
        impact: incident.impact ?? "",
        rootCause: incident.rootCause ?? "",
        mitigationSteps: incident.mitigationSteps ?? "",
        postMortemUrl: incident.postMortemUrl ?? "",
        note: "",
        assignment: "KEEP",
      }
    );
  }

  async function createIncident() {
    if (!incidentDraft.title.trim() || !data?.authority.canManage) return;
    setIncidentSaving(true);
    setError(null);
    try {
      await api("/incidents", {
        method: "POST",
        body: JSON.stringify({
          title: incidentDraft.title.trim(),
          severity: incidentDraft.severity,
          orgId: incidentDraft.orgId.trim() || null,
          runbookId: incidentDraft.runbookId || null,
          description: incidentDraft.description.trim() || null,
          impact: incidentDraft.impact.trim() || null,
          assignToSelf: incidentDraft.assignToSelf,
        }),
      });
      setIncidentDraft({
        title: "",
        severity: "SEV2",
        orgId: "",
        runbookId: "",
        description: "",
        impact: "",
        assignToSelf: true,
      });
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create incident.");
    } finally {
      setIncidentSaving(false);
    }
  }

  async function updateIncident(incident: Incident) {
    if (!data?.authority.canManage) return;
    const edit = incidentEdit(incident);
    setIncidentBusyId(incident.id);
    setError(null);
    try {
      await api("/incidents/" + encodeURIComponent(incident.id), {
        method: "PATCH",
        body: JSON.stringify({
          status: edit.status,
          severity: edit.severity,
          runbookId: edit.runbookId || null,
          impact: edit.impact.trim() || null,
          rootCause: edit.rootCause.trim() || null,
          mitigationSteps: edit.mitigationSteps.trim() || null,
          postMortemUrl: edit.postMortemUrl.trim() || null,
          note: edit.note.trim() || null,
          assignment: edit.assignment,
        }),
      });
      setIncidentEdits((current) => {
        const next = { ...current };
        delete next[incident.id];
        return next;
      });
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update incident.");
    } finally {
      setIncidentBusyId(null);
    }
  }

  async function createRunbook() {
    if (!data?.authority.canManage || !runbookDraft.title.trim()) return;
    setRunbookSaving(true);
    setError(null);
    try {
      if (runbookEditingId) {
        await api("/runbooks/" + encodeURIComponent(runbookEditingId), {
          method: "PATCH",
          body: JSON.stringify({
            title: runbookDraft.title.trim(),
            category: runbookDraft.category.trim(),
            content: runbookDraft.content.trim(),
          }),
        });
      } else {
        await api("/runbooks", {
          method: "POST",
          body: JSON.stringify({
            title: runbookDraft.title.trim(),
            slug: runbookDraft.slug.trim() || slugFromTitle(runbookDraft.title),
            category: runbookDraft.category.trim(),
            content: runbookDraft.content.trim(),
          }),
        });
      }
      setRunbookEditingId(null);
      setRunbookDraft((current) => ({
        ...current,
        title: "",
        slug: "",
      }));
      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : runbookEditingId
            ? "Unable to update runbook."
            : "Unable to create runbook.",
      );
    } finally {
      setRunbookSaving(false);
    }
  }

  function editRunbook(runbook: Runbook) {
    setRunbookEditingId(runbook.id);
    setRunbookDraft({
      title: runbook.title,
      slug: runbook.slug,
      category: runbook.category,
      content: runbook.content,
    });
    document
      .getElementById("compliance-runbook-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function toggleRunbook(runbook: Runbook) {
    if (!data?.authority.canManage) return;
    setRunbookBusyId(runbook.id);
    setError(null);
    try {
      await api("/runbooks/" + encodeURIComponent(runbook.id), {
        method: "PATCH",
        body: JSON.stringify({ isPublished: !runbook.isPublished }),
      });
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update runbook.");
    } finally {
      setRunbookBusyId(null);
    }
  }

  async function reviewRunbook(runbook: Runbook) {
    if (!data?.authority.canManage) return;
    setRunbookBusyId(runbook.id);
    setError(null);
    try {
      await api("/runbooks/" + encodeURIComponent(runbook.id) + "/review", {
        method: "POST",
        body: JSON.stringify({ nextReviewDays: 90 }),
      });
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to review runbook.");
    } finally {
      setRunbookBusyId(null);
    }
  }

  async function createRule() {
    if (!data?.authority.canManageRetention) return;
    setRuleSaving(true);
    setError(null);
    try {
      if (ruleEditingId) {
        await api("/audit-rules/" + encodeURIComponent(ruleEditingId), {
          method: "PATCH",
          body: JSON.stringify(ruleDraft),
        });
      } else {
        const { isActive: _isActive, ...createBody } = ruleDraft;
        await api("/audit-rules", {
          method: "POST",
          body: JSON.stringify(createBody),
        });
      }
      setRuleEditingId(null);
      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : ruleEditingId
            ? "Unable to update audit rule."
            : "Unable to create audit rule.",
      );
    } finally {
      setRuleSaving(false);
    }
  }

  function editRule(rule: AuditRule) {
    setRuleEditingId(rule.id);
    setRuleDraft({
      name: rule.name,
      entityType: rule.entityType,
      minRetentionDays: rule.minRetentionDays,
      description: rule.description ?? "",
      preventDeletion: rule.preventDeletion,
      preventModification: rule.preventModification,
      requireApproval: rule.requireApproval,
      isActive: rule.isActive,
    });
    document
      .getElementById("compliance-rule-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function createPolicy() {
    if (!data?.authority.canManageRetention) return;
    setPolicySaving(true);
    setError(null);
    try {
      if (policyEditingId) {
        await api("/retention/policies/" + encodeURIComponent(policyEditingId), {
          method: "PATCH",
          body: JSON.stringify({
            retentionDays: policyDraft.retentionDays,
            action: policyDraft.action,
            isActive: policyDraft.isActive,
            description: policyDraft.description.trim() || null,
          }),
        });
      } else {
        await api("/retention/policies", {
          method: "POST",
          body: JSON.stringify({
            entityType: policyDraft.entityType,
            retentionDays: policyDraft.retentionDays,
            action: policyDraft.action,
            scope: policyDraft.scope,
            orgId:
              policyDraft.scope === "ORGANIZATION"
                ? policyDraft.orgId.trim() || null
                : null,
            description: policyDraft.description.trim() || null,
          }),
        });
      }
      setPolicyEditingId(null);
      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : policyEditingId
            ? "Unable to update retention policy."
            : "Unable to create retention policy.",
      );
    } finally {
      setPolicySaving(false);
    }
  }

  function editPolicy(policy: RetentionPolicy) {
    setPolicyEditingId(policy.id);
    setPolicyDraft({
      entityType: policy.entityType,
      retentionDays: policy.retentionDays,
      action: policy.action,
      scope: policy.scope,
      orgId: policy.orgId ?? "",
      description: policy.description ?? "",
      isActive: policy.isActive,
    });
    document
      .getElementById("compliance-policy-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function togglePolicy(policy: RetentionPolicy) {
    if (!data?.authority.canManageRetention) return;
    setError(null);
    try {
      await api("/retention/policies/" + encodeURIComponent(policy.id), {
        method: "PATCH",
        body: JSON.stringify({ isActive: !policy.isActive }),
      });
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update retention policy.");
    }
  }

  async function previewPolicy(policy: RetentionPolicy) {
    setPreviewBusyId(policy.id);
    setError(null);
    try {
      const preview = await api<RetentionPreview>(
        "/retention/policies/" + encodeURIComponent(policy.id) + "/preview",
      );
      setPreviews((current) => ({ ...current, [policy.id]: preview }));
    } catch (cause) {
      setPreviews((current) => {
        const next = { ...current };
        delete next[policy.id];
        return next;
      });
      setError(cause instanceof Error ? cause.message : "Retention preview failed.");
    } finally {
      setPreviewBusyId(null);
    }
  }

  async function executePolicy(policy: RetentionPolicy) {
    if (!data?.authority.canManageRetention) return;
    const entry = executionInputs[policy.id] ?? { confirm: "", reason: "" };
    if (entry.confirm !== policy.entityType || entry.reason.trim().length < 10) return;

    setExecuteBusyId(policy.id);
    setError(null);
    try {
      await api("/retention/policies/" + encodeURIComponent(policy.id) + "/execute", {
        method: "POST",
        body: JSON.stringify({
          confirmEntityType: entry.confirm,
          reason: entry.reason.trim(),
        }),
      });
      setExecutionInputs((current) => ({
        ...current,
        [policy.id]: { confirm: "", reason: "" },
      }));
      setPreviews((current) => {
        const next = { ...current };
        delete next[policy.id];
        return next;
      });
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retention execution failed.");
    } finally {
      setExecuteBusyId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading governance control plane…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Governance controls unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "Platform compliance authority is required."}
        </p>
        <button
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  const selectedActions =
    data.retention.supportedEntities.find(
      (entry) => entry.entityType === policyDraft.entityType,
    )?.actions ?? ["DELETE"];

  return (
    <div className="space-y-7">
      {data.authority.viaBootstrap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Governance authority is currently using the MigraAuth bootstrap path. Grant a persistent platform role before removing bootstrap authority.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Governance control plane
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              Cases, runbooks & retention
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Governance records live here. MigraGuard remains the attack-detection and response engine; this surface owns auditable incident cases, response runbooks, evidence-retention rules, and bounded retention execution.
            </p>
          </div>
          <button
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            icon={<Siren size={16} />}
            label="Active incidents"
            value={data.metrics.activeIncidents}
            detail={
              data.metrics.sev1Active
                ? data.metrics.sev1Active + " active SEV1"
                : "No active SEV1"
            }
          />
          <Metric
            icon={<ShieldAlert size={16} />}
            label="SEV2 active"
            value={data.metrics.sev2Active}
            detail="Governance cases"
          />
          <Metric
            icon={<BookOpenCheck size={16} />}
            label="Runbooks due"
            value={data.metrics.dueRunbooks}
            detail="Published review cadence"
          />
          <Metric
            icon={<Clock3 size={16} />}
            label="Retention policies"
            value={data.metrics.activeRetentionPolicies}
            detail="Active executable policy"
          />
          <Metric
            icon={<FileLock2 size={16} />}
            label="Immutable rules"
            value={data.metrics.activeAuditRules}
            detail="Active evidence guardrails"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <SectionHeader
          eyebrow="Incident governance"
          title="Incident cases"
          description="Open and progress auditable governance cases. Use MigraGuard for attack telemetry and automated response; use this case record for impact, decisions, runbook linkage, root cause, and post-mortem evidence."
        />

        {data.authority.canManage ? (
          <div className="grid gap-4 border-b border-slate-100 p-5 sm:p-6 xl:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-slate-800">
                Incident title
                <input
                  value={incidentDraft.title}
                  onChange={(event) =>
                    setIncidentDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Production authentication degradation"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Severity
                  <select
                    value={incidentDraft.severity}
                    onChange={(event) =>
                      setIncidentDraft((current) => ({
                        ...current,
                        severity: event.target.value as Incident["severity"],
                      }))
                    }
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  >
                    {INCIDENT_SEVERITIES.map((severity) => (
                      <option key={severity} value={severity}>
                        {severity}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Organization <span className="font-normal text-slate-400">(optional)</span>
                  <select
                    value={incidentDraft.orgId}
                    onChange={(event) =>
                      setIncidentDraft((current) => ({
                        ...current,
                        orgId: event.target.value,
                      }))
                    }
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="">Platform-wide incident</option>
                    {data.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name} · {organization.slug}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-semibold text-slate-800">
                Runbook
                <select
                  value={incidentDraft.runbookId}
                  onChange={(event) =>
                    setIncidentDraft((current) => ({
                      ...current,
                      runbookId: event.target.value,
                    }))
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">No runbook selected</option>
                  {data.runbooks.map((runbook) => (
                    <option key={runbook.id} value={runbook.id}>
                      {runbook.title} · v{runbook.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={incidentDraft.assignToSelf}
                  onChange={(event) =>
                    setIncidentDraft((current) => ({
                      ...current,
                      assignToSelf: event.target.checked,
                    }))
                  }
                />
                Assign this case to me when it is opened
              </label>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-semibold text-slate-800">
                Description
                <textarea
                  value={incidentDraft.description}
                  onChange={(event) =>
                    setIncidentDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Known impact
                <textarea
                  value={incidentDraft.impact}
                  onChange={(event) =>
                    setIncidentDraft((current) => ({
                      ...current,
                      impact: event.target.value,
                    }))
                  }
                  rows={2}
                  className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
              </label>
              <button
                onClick={() => void createIncident()}
                disabled={incidentSaving || incidentDraft.title.trim().length < 3}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {incidentSaving ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Plus size={15} />
                )}
                Open incident case
              </button>
            </div>
          </div>
        ) : (
          <ReadOnlyNotice text="Read-only governance authority. Incident-management permission is required to open or progress cases." />
        )}

        {data.incidents.length === 0 ? (
          <Empty
            icon={<Siren size={21} />}
            title="No incident cases"
            description="No governance incidents have been recorded yet."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.incidents.map((incident) => {
              const edit = incidentEdit(incident);
              const busy = incidentBusyId === incident.id;
              const allowedStatuses = Array.from(
                new Set([
                  incident.status,
                  ...(data.incidentTransitions[incident.status] ?? []),
                ]),
              );
              return (
                <article key={incident.id} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            "rounded-full border px-2 py-0.5 text-[10px] font-bold " +
                            severityClass(incident.severity)
                          }
                        >
                          {incident.severity}
                        </span>
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                            statusClass(incident.status)
                          }
                        >
                          {incident.status.replaceAll("_", " ")}
                        </span>
                        {incident.orgName ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {incident.orgName}
                          </span>
                        ) : (
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                            Platform-wide
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-slate-950">
                        {incident.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Detected {formatDate(incident.detectedAt)}
                        {incident.runbookTitle
                          ? " · Runbook: " + incident.runbookTitle
                          : ""}
                        {incident.assignedToName
                          ? " · Assigned: " + incident.assignedToName
                          : " · Unassigned"}
                      </p>
                      {incident.description ? (
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          {incident.description}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Evidence label="Impact" value={incident.impact || "Not documented"} />
                    <Evidence
                      label="Root cause"
                      value={incident.rootCause || "Not established"}
                    />
                    <Evidence
                      label="Mitigation"
                      value={incident.mitigationSteps || "Not documented"}
                    />
                    <Evidence
                      label="Post-mortem"
                      value={incident.postMortemUrl || "Not attached"}
                    />
                  </div>

                  {data.authority.canManage ? (
                    <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:grid-cols-2">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-slate-700">
                          Status
                          <select
                            value={edit.status}
                            onChange={(event) =>
                              setIncidentEdits((current) => ({
                                ...current,
                                [incident.id]: {
                                  ...edit,
                                  status: event.target.value as Incident["status"],
                                },
                              }))
                            }
                            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs"
                          >
                            {allowedStatuses.map((status) => (
                              <option key={status} value={status}>
                                {status.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          Severity
                          <select
                            value={edit.severity}
                            onChange={(event) =>
                              setIncidentEdits((current) => ({
                                ...current,
                                [incident.id]: {
                                  ...edit,
                                  severity: event.target.value as Incident["severity"],
                                },
                              }))
                            }
                            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs"
                          >
                            {INCIDENT_SEVERITIES.map((severity) => (
                              <option key={severity} value={severity}>
                                {severity}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
                          Assignment
                          <select
                            value={edit.assignment}
                            onChange={(event) =>
                              setIncidentEdits((current) => ({
                                ...current,
                                [incident.id]: {
                                  ...edit,
                                  assignment: event.target.value as
                                    | "KEEP"
                                    | "SELF"
                                    | "UNASSIGN",
                                },
                              }))
                            }
                            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs"
                          >
                            <option value="KEEP">
                              Keep current{incident.assignedToName ? " · " + incident.assignedToName : " · unassigned"}
                            </option>
                            <option value="SELF">Assign to me</option>
                            <option value="UNASSIGN">Unassign</option>
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
                          Timeline note
                          <input
                            value={edit.note}
                            onChange={(event) =>
                              setIncidentEdits((current) => ({
                                ...current,
                                [incident.id]: {
                                  ...edit,
                                  note: event.target.value,
                                },
                              }))
                            }
                            placeholder="What changed and why?"
                            className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs"
                          />
                        </label>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(
                          [
                            ["impact", "Impact"],
                            ["rootCause", "Root cause"],
                            ["mitigationSteps", "Mitigation"],
                            ["postMortemUrl", "Post-mortem URL"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="text-xs font-semibold text-slate-700">
                            {label}
                            <input
                              value={edit[key]}
                              onChange={(event) =>
                                setIncidentEdits((current) => ({
                                  ...current,
                                  [incident.id]: {
                                    ...edit,
                                    [key]: event.target.value,
                                  },
                                }))
                              }
                              className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs"
                            />
                          </label>
                        ))}
                        <button
                          onClick={() => void updateIncident(incident)}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-2"
                        >
                          {busy ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={14} />
                          )}
                          Save incident evidence
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(incident.timeline) && incident.timeline.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Timeline
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {incident.timeline.slice(-6).map((entry, index) => (
                          <span
                            key={incident.id + ":" + index}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-600"
                          >
                            {typeof entry.event === "string" ? entry.event : "EVENT"}
                            {typeof entry.to === "string" ? " → " + entry.to : ""}
                            {typeof entry.note === "string" ? " · " + entry.note : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <SectionHeader
          eyebrow="Response knowledge"
          title="Compliance runbooks"
          description="Version and review the human response procedures that incident cases can reference."
        />

        {data.authority.canManage ? (
          <div className="grid gap-4 border-b border-slate-100 p-5 sm:p-6 xl:grid-cols-[0.72fr_1.28fr]">
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-slate-800">
                Title
                <input
                  value={runbookDraft.title}
                  onChange={(event) =>
                    setRunbookDraft((current) => ({
                      ...current,
                      title: event.target.value,
                      slug:
                        current.slug || slugFromTitle(event.target.value),
                    }))
                  }
                  placeholder="Production authentication incident"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Slug
                <input
                  value={runbookDraft.slug}
                  onChange={(event) =>
                    setRunbookDraft((current) => ({
                      ...current,
                      slug: slugFromTitle(event.target.value),
                    }))
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-xs"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Category
                <input
                  value={runbookDraft.category}
                  onChange={(event) =>
                    setRunbookDraft((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm"
                />
              </label>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-800">
                Markdown procedure
                <textarea
                  value={runbookDraft.content}
                  onChange={(event) =>
                    setRunbookDraft((current) => ({
                      ...current,
                      content: event.target.value,
                    }))
                  }
                  rows={9}
                  className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-xs leading-5 text-slate-100"
                />
              </label>
              <button
                onClick={() => void createRunbook()}
                disabled={
                  runbookSaving ||
                  runbookDraft.title.trim().length < 3 ||
                  runbookDraft.content.trim().length < 20
                }
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {runbookSaving ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Plus size={15} />
                )}
                Create runbook
              </button>
            </div>
          </div>
        ) : (
          <ReadOnlyNotice text="Read-only governance authority. Compliance-management permission is required to create or publish runbooks." />
        )}

        {data.runbooks.length === 0 ? (
          <Empty
            icon={<BookOpenCheck size={21} />}
            title="No runbooks"
            description="Create the first governed response procedure."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.runbooks.map((runbook) => {
              const due =
                runbook.isPublished &&
                (!runbook.nextReviewAt ||
                  new Date(runbook.nextReviewAt).getTime() <= Date.now());
              const busy = runbookBusyId === runbook.id;
              return (
                <article key={runbook.id} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                            (runbook.isPublished
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-600")
                          }
                        >
                          {runbook.isPublished ? "PUBLISHED" : "DRAFT"}
                        </span>
                        {due ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            REVIEW DUE
                          </span>
                        ) : null}
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          v{runbook.version}
                        </span>
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-slate-950">
                        {runbook.title}
                      </h3>
                      <code className="mt-1 block text-[11px] text-slate-400">
                        {runbook.slug}
                      </code>
                      <p className="mt-2 text-xs text-slate-500">
                        {runbook.category} · {runbook.incidentCount} linked incident
                        {runbook.incidentCount === 1 ? "" : "s"} · Next review{" "}
                        {formatDate(runbook.nextReviewAt)}
                      </p>
                    </div>
                    {data.authority.canManage ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => void toggleRunbook(runbook)}
                          disabled={busy}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {runbook.isPublished ? "Return to draft" : "Publish"}
                        </button>
                        <button
                          onClick={() => void reviewRunbook(runbook)}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={13} />
                          )}
                          Review +90d
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <pre className="mt-4 max-h-44 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-950 p-4 text-[11px] leading-5 text-slate-200">
                    {runbook.content}
                  </pre>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <SectionHeader
          eyebrow="Evidence lifecycle"
          title="Retention & immutability"
          description={
            "Retention is destructive governance, not housekeeping. Execution is limited to " +
            data.retention.execution.batchLimit.toLocaleString() +
            " records per run, rechecks immutable rules at execution time, and never exposes ARCHIVE until real cold storage exists."
          }
        />

        {!data.authority.canManageRetention ? (
          <ReadOnlyNotice text="Read-only retention posture. Only MigraTeck platform OWNER authority may change or execute retention and immutable-audit policy." />
        ) : (
          <div className="grid gap-6 border-b border-slate-100 p-5 sm:p-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <FileLock2 size={16} className="text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-950">
                  Create immutable audit rule
                </h3>
              </div>
              <div className="mt-4 grid gap-3">
                <input
                  value={ruleDraft.name}
                  onChange={(event) =>
                    setRuleDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Rule name"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={ruleDraft.entityType}
                    onChange={(event) =>
                      setRuleDraft((current) => ({
                        ...current,
                        entityType: event.target.value,
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs"
                  >
                    {data.retention.supportedEntities.map((entry) => (
                      <option key={entry.entityType} value={entry.entityType}>
                        {entry.entityType}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={ruleDraft.minRetentionDays}
                    onChange={(event) =>
                      setRuleDraft((current) => ({
                        ...current,
                        minRetentionDays: Number(event.target.value),
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs"
                  />
                </div>
                <textarea
                  value={ruleDraft.description}
                  onChange={(event) =>
                    setRuleDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={2}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                />
                <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                  {(
                    [
                      ["preventDeletion", "Prevent early deletion"],
                      ["preventModification", "Prevent anonymization"],
                      ["requireApproval", "Require approval workflow"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ruleDraft[key]}
                        onChange={(event) =>
                          setRuleDraft((current) => ({
                            ...current,
                            [key]: event.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => void createRule()}
                  disabled={ruleSaving || ruleDraft.name.trim().length < 2}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {ruleSaving ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={13} />
                  )}
                  Create immutable rule
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Clock3 size={16} className="text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-950">
                  Create retention policy
                </h3>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    value={policyDraft.entityType}
                    onChange={(event) => {
                      const entityType = event.target.value;
                      const actions =
                        data.retention.supportedEntities.find(
                          (entry) => entry.entityType === entityType,
                        )?.actions ?? ["DELETE"];
                      setPolicyDraft((current) => ({
                        ...current,
                        entityType,
                        action: actions.includes(current.action)
                          ? current.action
                          : (actions[0] ?? "DELETE"),
                      }));
                    }}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs"
                  >
                    {data.retention.supportedEntities.map((entry) => (
                      <option key={entry.entityType} value={entry.entityType}>
                        {entry.entityType}
                      </option>
                    ))}
                  </select>
                  <select
                    value={policyDraft.action}
                    onChange={(event) =>
                      setPolicyDraft((current) => ({
                        ...current,
                        action: event.target.value as "DELETE" | "ANONYMIZE",
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs"
                  >
                    {selectedActions.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={policyDraft.retentionDays}
                    onChange={(event) =>
                      setPolicyDraft((current) => ({
                        ...current,
                        retentionDays: Number(event.target.value),
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs"
                  />
                  <select
                    value={policyDraft.scope}
                    onChange={(event) =>
                      setPolicyDraft((current) => ({
                        ...current,
                        scope: event.target.value as "PLATFORM" | "ORGANIZATION",
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs"
                  >
                    <option value="PLATFORM">PLATFORM</option>
                    <option value="ORGANIZATION">ORGANIZATION</option>
                  </select>
                </div>
                {policyDraft.scope === "ORGANIZATION" ? (
                  <select
                    value={policyDraft.orgId}
                    onChange={(event) =>
                      setPolicyDraft((current) => ({
                        ...current,
                        orgId: event.target.value,
                      }))
                    }
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs"
                  >
                    <option value="">Select organization</option>
                    {data.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name} · {organization.slug}
                      </option>
                    ))}
                  </select>
                ) : null}
                <textarea
                  value={policyDraft.description}
                  onChange={(event) =>
                    setPolicyDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Why does this retention period exist?"
                  rows={2}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                />
                <button
                  onClick={() => void createPolicy()}
                  disabled={
                    policySaving ||
                    policyDraft.retentionDays < 1 ||
                    (policyDraft.scope === "ORGANIZATION" &&
                      !policyDraft.orgId.trim())
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {policySaving ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Plus size={13} />
                  )}
                  Create retention policy
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[0.72fr_1.28fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Immutable rules
            </p>
            <div className="mt-3 space-y-3">
              {data.retention.rules.length === 0 ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                  No immutable audit rules exist yet. AuditLog DELETE execution is therefore blocked by design.
                </p>
              ) : (
                data.retention.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[9px] font-bold " +
                          (rule.isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-200 text-slate-500")
                        }
                      >
                        {rule.isActive ? "ACTIVE" : "INACTIVE"}
                      </span>
                      <span className="text-xs font-semibold text-slate-900">
                        {rule.name}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-slate-500">
                      {rule.entityType} · minimum {rule.minRetentionDays} days ·{" "}
                      {rule.preventDeletion ? "deletion protected" : "deletion allowed"} ·{" "}
                      {rule.preventModification
                        ? "modification protected"
                        : "modification allowed"}
                      {rule.requireApproval ? " · approval required" : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Executable policies
            </p>
            <div className="mt-3 space-y-4">
              {data.retention.policies.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-500">
                  No retention policies are configured.
                </p>
              ) : (
                data.retention.policies.map((policy) => {
                  const preview = previews[policy.id];
                  const execution = executionInputs[policy.id] ?? {
                    confirm: "",
                    reason: "",
                  };
                  const canExecute =
                    data.authority.canManageRetention &&
                    !!preview &&
                    execution.confirm === policy.entityType &&
                    execution.reason.trim().length >= 10 &&
                    policy.isActive;
                  return (
                    <div
                      key={policy.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={
                                "rounded-full px-2 py-0.5 text-[9px] font-bold " +
                                (policy.isActive
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-500")
                              }
                            >
                              {policy.isActive ? "ACTIVE" : "PAUSED"}
                            </span>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">
                              {policy.action}
                            </span>
                            <span className="text-xs font-semibold text-slate-900">
                              {policy.entityType}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {policy.retentionDays} days · {policy.scope}
                            {policy.orgId
                              ? " · " +
                                (organizationMap.get(policy.orgId)?.name ??
                                  policy.orgId)
                              : ""}
                          </p>
                          {policy.description ? (
                            <p className="mt-2 text-xs leading-5 text-slate-600">
                              {policy.description}
                            </p>
                          ) : null}
                        </div>
                        {data.authority.canManageRetention ? (
                          <button
                            onClick={() => void togglePolicy(policy)}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {policy.isActive ? "Pause" : "Activate"}
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <button
                          onClick={() => void previewPolicy(policy)}
                          disabled={previewBusyId === policy.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50"
                        >
                          {previewBusyId === policy.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Gauge size={13} />
                          )}
                          Dry-run eligible records
                        </button>

                        {preview ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <Mini
                              label="Eligible"
                              value={preview.eligibleRecords.toLocaleString()}
                            />
                            <Mini label="Cutoff" value={formatDate(preview.cutoff)} />
                            <Mini
                              label="Max this run"
                              value={preview.batchLimit.toLocaleString()}
                            />
                          </div>
                        ) : null}

                        {data.authority.canManageRetention && preview ? (
                          <div className="mt-4 border-t border-slate-200 pt-4">
                            <div className="flex items-start gap-2 text-rose-800">
                              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                              <p className="text-xs leading-5">
                                Destructive execution is separate from preview. Type{" "}
                                <code className="font-bold">{policy.entityType}</code> and document the reason. The API rechecks immutable rules and scope at execution time.
                              </p>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <input
                                value={execution.confirm}
                                onChange={(event) =>
                                  setExecutionInputs((current) => ({
                                    ...current,
                                    [policy.id]: {
                                      ...execution,
                                      confirm: event.target.value,
                                    },
                                  }))
                                }
                                placeholder={"Type " + policy.entityType}
                                className="h-10 rounded-xl border border-rose-200 bg-white px-3 font-mono text-xs"
                              />
                              <input
                                value={execution.reason}
                                onChange={(event) =>
                                  setExecutionInputs((current) => ({
                                    ...current,
                                    [policy.id]: {
                                      ...execution,
                                      reason: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="Reason for this retention execution"
                                className="h-10 rounded-xl border border-rose-200 bg-white px-3 text-xs"
                              />
                            </div>
                            <button
                              onClick={() => void executePolicy(policy)}
                              disabled={!canExecute || executeBusyId === policy.id}
                              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {executeBusyId === policy.id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Play size={13} />
                              )}
                              Execute one bounded batch
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {policy.executions.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {policy.executions.slice(0, 5).map((executionRow) => (
                            <span
                              key={executionRow.id}
                              className={
                                "rounded-xl border px-2.5 py-1.5 text-[10px] " +
                                (executionRow.error
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600")
                              }
                            >
                              {formatDate(executionRow.startedAt)} ·{" "}
                              {executionRow.recordsAffected} affected
                              {executionRow.error ? " · " + executionRow.error : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-slate-100 p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
        {title}
      </h2>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
        {description}
      </p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-700">{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-xs font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function Empty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-44 place-items-center p-8 text-center">
      <div>
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-500">
          {icon}
        </span>
        <h3 className="mt-3 text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function ReadOnlyNotice({ text }: { text: string }) {
  return (
    <div className="border-b border-slate-100 bg-slate-50 px-5 py-4 text-xs leading-5 text-slate-600 sm:px-6">
      {text}
    </div>
  );
}
