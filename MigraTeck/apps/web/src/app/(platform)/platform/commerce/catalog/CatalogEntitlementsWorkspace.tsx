"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Edit3,
  Layers3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

type ProductKey =
  | "MIGRATECK"
  | "MIGRAHOSTING"
  | "MIGRAPANEL"
  | "MIGRAVOICE"
  | "MIGRAMAIL"
  | "MIGRAINTAKE"
  | "MIGRAMARKET"
  | "MIGRAPILOT"
  | "MIGRAINVOICE"
  | "MIGRADRIVE"
  | "MIGRABUILDER";

type EntitlementStatus =
  | "ACTIVE"
  | "TRIAL"
  | "RESTRICTED"
  | "INTERNAL_ONLY";

type DriftClassification =
  | "active_access_needs_verification"
  | "superseded_by_success"
  | "access_not_active"
  | "unmapped_legacy_job";

type WorkerStatus = {
  ready: boolean;
  workerId: string | null;
  pid: number | null;
  lastSeenAt: string | null;
  ageMs: number | null;
  reason: string | null;
};

type ProvisioningInputDescriptor = {
  key: string;
  label: string;
  placeholder: string;
  kind: "text" | "email" | "password" | "number" | "json";
  sensitive: boolean;
  min?: number;
  max?: number;
};

type EntitlementTransition = {
  product: ProductKey;
  fromStatus: EntitlementStatus;
  toStatus: EntitlementStatus;
  available: boolean;
  mode: "database_only" | "provisioning" | "blocked";
  actions: string[];
  requiredFields: string[];
  requiredInputs: ProvisioningInputDescriptor[];
  reason: string | null;
};

type EntitlementReconciliation = {
  product: ProductKey;
  status: EntitlementStatus;
  available: boolean;
  mode: "provisioning" | "blocked" | "not_required";
  actions: string[];
  requiredFields: string[];
  requiredInputs: ProvisioningInputDescriptor[];
  reason: string | null;
};

type AccessEntitlement = {
  product: ProductKey;
  status: EntitlementStatus;
  startsAt: string | null;
  endsAt: string | null;
  notes: string | null;
  updatedAt: string | null;
  persisted: boolean;
  evidence: "stripe_sync" | "manual_or_legacy" | "none";
};

type EntitlementEditorState = {
  product: ProductKey;
  status: EntitlementStatus;
  reason: string;
  notes: string;
  acknowledgeBillingOverride: boolean;
  context: Record<string, string>;
};

type ReconciliationEditorState = {
  product: ProductKey;
  reason: string;
  context: Record<string, string>;
};

type CatalogPrice = {
  lookupKey: string;
  componentType: string;
  billingInterval: string;
  unitAmount: number | null;
  meterName: string | null;
  usageDimension: string | null;
};

type CatalogPlan = {
  planCode: string;
  name: string;
  description: string;
  trialDays: number | null;
  entitlementCount: number;
  entitlements: Record<string, string | number | boolean>;
  prices: CatalogPrice[];
};

type CatalogProduct = {
  productFamily: string;
  productKey: ProductKey | null;
  name: string;
  description: string;
  planCount: number;
  priceCount: number;
  plans: CatalogPlan[];
};

type Binding = {
  id: string;
  provider: string;
  externalPriceId: string;
  product: ProductKey;
  statusOnActive: "ACTIVE" | "TRIAL" | "RESTRICTED" | "INTERNAL_ONLY";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type CatalogPayload = {
  authority: {
    roles: string[];
    permissions: string[];
    viaBootstrap: boolean;
  };
  catalog: CatalogProduct[];
  bindings: Binding[];
  bindingCoverage: Array<{
    product: ProductKey;
    bindings: number;
    activeEntitlements: number;
    restrictedEntitlements: number;
  }>;
  readiness: {
    canonicalCatalogAuthority: string;
    nativeCatalogMirrorReady: boolean;
    effectiveEntitlementAuthority: string | null;
    tables: Record<string, { present: boolean; rows: number | null }>;
  };
  provisioning: {
    summary: Array<{
      status: string;
      count: number;
      oldest: string | null;
      newest: string | null;
    }>;
    deadJobs: Array<{
      id: string;
      orgId: string;
      orgName: string | null;
      orgSlug: string | null;
      source: string;
      type: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      lastErrorAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    drift: {
      needsVerification: number;
      rows: Array<{
        orgId: string;
        orgName: string | null;
        orgSlug: string | null;
        product: string | null;
        entitlementStatus: string | null;
        entitlementUpdatedAt: string | null;
        deadJobs: number;
        latestDeadAt: string | null;
        lastDeadError: string | null;
        succeededJobs: number;
        latestSuccessAt: string | null;
        subscriptionCount: number;
        classification: DriftClassification;
      }>;
    };
  };
  metrics: {
    catalogProducts: number;
    catalogPlans: number;
    catalogPrices: number;
    liveBindings: number;
    effectiveEntitlements: number;
    provisioningPending: number;
    provisioningRunning: number;
    provisioningSucceeded: number;
    provisioningFailed: number;
    provisioningDead: number;
    provisioningCanceled: number;
    provisioningDriftNeedsVerification: number;
  };
  mutationReadiness: {
    bindings: boolean;
    entitlements: boolean;
    entitlementReason: string;
    worker: WorkerStatus;
  };
};

type DeadLetterRecoveryContext = Record<string, string>;

type HostingRecoveryCandidate = {
  tenantId: string;
  name: string | null;
  slug: string | null;
  companyName: string | null;
  status: string | null;
  matchScore: number;
  matchReason:
    | "exact_slug"
    | "exact_name"
    | "normalized_identity"
    | "partial_match"
    | "explicit_selection";
  domains: string[];
  serviceInstances: Array<{
    id: string;
    status: string;
  }>;
  targetIps: string[];
  suggestedContext: Partial<DeadLetterRecoveryContext>;
};

type HostingTenantSearchResult = {
  id: string;
  name: string | null;
  slug: string | null;
  domain: string | null;
  status: string | null;
  tenantType: string | null;
  companyName: string | null;
  websiteCount: number;
};

type DeadLetterRemediation = {
  job: {
    id: string;
    orgId: string;
    orgName: string | null;
    orgSlug: string | null;
    source: string;
    type: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    productLane: string | null;
    action: string | null;
  };
  retry: {
    available: boolean;
    reason: string | null;
    malformed: boolean;
    payloadHashValid: boolean;
    signatureValid: boolean;
    requiredFields: string[];
    requiredInputs: ProvisioningInputDescriptor[];
    missingFields: string[];
    currentContext: Partial<DeadLetterRecoveryContext>;
    hostingCandidates?: HostingRecoveryCandidate[];
    suggestionReason?: string | null;
    worker: WorkerStatus;
    provisioningPaused: boolean;
  };
  cancel: {
    available: boolean;
  };
};

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  isMigraHostingClient: boolean;
  authOrganizationId: string | null;
  entitlementCount: number;
  activeEntitlementCount: number;
  subscriptionCount: number;
  accessUpdatedAt: string | null;
};

type AccessPayload = {
  canManageEntitlements: boolean;
  worker: WorkerStatus;
  transitions: Array<{
    product: ProductKey;
    currentStatus: EntitlementStatus;
    targets: EntitlementTransition[];
    reconciliation: EntitlementReconciliation;
  }>;
  organization: {
    id: string;
    name: string;
    slug: string;
    isMigraHostingClient: boolean;
    authOrganizationId: string | null;
  };
  entitlements: AccessEntitlement[];
  subscriptions: Array<{
    id: string;
    provider: string;
    externalSubscriptionId: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
  }>;
  recentProvisioningJobs: Array<{
    id: string;
    source: string;
    type: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    notBefore: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

type BindingEditor = {
  externalPriceId: string;
  product: ProductKey;
  statusOnActive: "ACTIVE" | "TRIAL" | "RESTRICTED" | "INTERNAL_ONLY";
  notes: string;
};

const PRODUCT_KEYS: ProductKey[] = [
  "MIGRATECK",
  "MIGRAHOSTING",
  "MIGRAPANEL",
  "MIGRAVOICE",
  "MIGRAMAIL",
  "MIGRAINTAKE",
  "MIGRAMARKET",
  "MIGRAPILOT",
  "MIGRAINVOICE",
  "MIGRADRIVE",
  "MIGRABUILDER",
];

const emptyBinding: BindingEditor = {
  externalPriceId: "",
  product: "MIGRAHOSTING",
  statusOnActive: "ACTIVE",
  notes: "",
};

function formatMoney(cents: number | null) {
  if (cents === null) return "Metered";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function statusClass(status: string) {
  if (["ACTIVE", "SUCCEEDED"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["TRIAL", "PENDING", "RUNNING"].includes(status)) return "bg-blue-50 text-blue-700";
  if (["RESTRICTED", "FAILED", "DEAD"].includes(status)) return "bg-rose-50 text-rose-700";
  if (status === "INTERNAL_ONLY") return "bg-violet-50 text-violet-700";
  return "bg-slate-100 text-slate-600";
}

function driftLabel(classification: DriftClassification) {
  switch (classification) {
    case "active_access_needs_verification":
      return "Needs verification";
    case "superseded_by_success":
      return "Later success found";
    case "access_not_active":
      return "Access not active";
    case "unmapped_legacy_job":
      return "Legacy lane unmapped";
  }
}

function driftClass(classification: DriftClassification) {
  switch (classification) {
    case "active_access_needs_verification":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "superseded_by_success":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "access_not_active":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "unmapped_legacy_job":
      return "border-violet-200 bg-violet-50 text-violet-800";
  }
}

export function CatalogEntitlementsWorkspace() {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [bindingEditor, setBindingEditor] = useState<BindingEditor>(emptyBinding);
  const [bindingSaving, setBindingSaving] = useState(false);
  const [bindingMessage, setBindingMessage] = useState<string | null>(null);
  const [orgQuery, setOrgQuery] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [entitlementEditor, setEntitlementEditor] =
    useState<EntitlementEditorState | null>(null);
  const [entitlementSaving, setEntitlementSaving] = useState(false);
  const [entitlementMessage, setEntitlementMessage] = useState<string | null>(null);
  const [reconciliationEditor, setReconciliationEditor] =
    useState<ReconciliationEditorState | null>(null);
  const [reconciliationSaving, setReconciliationSaving] = useState(false);
  const [reconciliationMessage, setReconciliationMessage] =
    useState<string | null>(null);
  const [deadLetter, setDeadLetter] = useState<DeadLetterRemediation | null>(null);
  const [deadLetterLoadingId, setDeadLetterLoadingId] = useState<string | null>(null);
  const [deadLetterError, setDeadLetterError] = useState<string | null>(null);
  const [deadLetterMessage, setDeadLetterMessage] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setCatalogError(null);
    try {
      const response = await fetch("/api/platform/commerce/catalog", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load commerce catalog");
      setCatalog(body);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Unable to load commerce catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrganizations = useCallback(async (query: string) => {
    setOrgLoading(true);
    try {
      const params = new URLSearchParams({ limit: "40" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(
        "/api/platform/commerce/organizations?" + params.toString(),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to search organizations");
      setOrganizations(body.organizations ?? []);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Unable to search organizations");
    } finally {
      setOrgLoading(false);
    }
  }, []);

  const loadAccess = useCallback(async (orgId: string) => {
    setAccessLoading(true);
    setAccessError(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/organizations/" +
          encodeURIComponent(orgId) +
          "/entitlements",
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load organization access");
      setAccess(body);
    } catch (error) {
      setAccess(null);
      setAccessError(error instanceof Error ? error.message : "Unable to load organization access");
    } finally {
      setAccessLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadOrganizations("");
  }, [loadCatalog, loadOrganizations]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOrganizations(orgQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [orgQuery, loadOrganizations]);

  const coverageByProduct = useMemo(
    () => new Map(catalog?.bindingCoverage.map((entry) => [entry.product, entry]) ?? []),
    [catalog],
  );

  async function selectOrganization(orgId: string) {
    setSelectedOrgId(orgId);
    setEntitlementEditor(null);
    setEntitlementMessage(null);
    setReconciliationEditor(null);
    setReconciliationMessage(null);
    await loadAccess(orgId);
  }

  async function inspectDriftOrganization(orgId: string) {
    await selectOrganization(orgId);
    window.setTimeout(() => {
      document
        .getElementById("organization-access")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function transitionFor(
    product: ProductKey,
    status: EntitlementStatus,
  ): EntitlementTransition | null {
    const row = access?.transitions.find((item) => item.product === product);
    return row?.targets.find((target) => target.toStatus === status) ?? null;
  }

  function reconciliationFor(
    product: ProductKey,
  ): EntitlementReconciliation | null {
    return (
      access?.transitions.find((item) => item.product === product)
        ?.reconciliation ?? null
    );
  }

  function openEntitlementEditor(entitlement: AccessEntitlement) {
    setReconciliationEditor(null);
    setReconciliationMessage(null);
    setEntitlementEditor({
      product: entitlement.product,
      status: entitlement.status,
      reason: "",
      notes: entitlement.notes ?? "",
      acknowledgeBillingOverride: false,
      context: {},
    });
    setEntitlementMessage(null);
  }

  async function saveEntitlement() {
    if (!access || !selectedOrgId || !entitlementEditor) return;

    const current = access.entitlements.find(
      (item) => item.product === entitlementEditor.product,
    );
    const transition = transitionFor(
      entitlementEditor.product,
      entitlementEditor.status,
    );

    if (!current || !transition) {
      setEntitlementMessage("Refresh access evidence before saving this change.");
      return;
    }
    if (!transition.available) {
      setEntitlementMessage(
        transition.reason ?? "This transition is not operationally ready.",
      );
      return;
    }
    if (entitlementEditor.reason.trim().length < 3) {
      setEntitlementMessage("An operator reason is required.");
      return;
    }

    const descriptorKeys = new Set(
      transition.requiredInputs.map((input) => input.key),
    );
    const missingDescriptors = transition.requiredFields.filter(
      (field) => !descriptorKeys.has(field),
    );
    if (missingDescriptors.length > 0) {
      setEntitlementMessage(
        "Provisioning input metadata is incomplete for: " +
          missingDescriptors.join(", ") +
          ". Refresh before retrying.",
      );
      return;
    }

    const context: Record<string, unknown> = {};
    for (const input of transition.requiredInputs) {
      const raw = entitlementEditor.context[input.key] ?? "";
      const normalized = input.kind === "password" ? raw : raw.trim();
      if (!normalized.length) continue;

      if (input.kind === "number") {
        const numeric = Number(normalized);
        if (!Number.isFinite(numeric)) {
          setEntitlementMessage(input.label + " must be a valid number.");
          return;
        }
        if (input.min !== undefined && numeric < input.min) {
          setEntitlementMessage(
            input.label + " must be at least " + input.min + ".",
          );
          return;
        }
        if (input.max !== undefined && numeric > input.max) {
          setEntitlementMessage(
            input.label + " must be no more than " + input.max + ".",
          );
          return;
        }
        context[input.key] = numeric;
        continue;
      }

      if (input.kind === "json") {
        try {
          const parsed = JSON.parse(normalized) as unknown;
          if (
            parsed === null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
          ) {
            setEntitlementMessage(
              input.label + " must be a JSON object.",
            );
            return;
          }
          context[input.key] = parsed;
        } catch {
          setEntitlementMessage(input.label + " must contain valid JSON.");
          return;
        }
        continue;
      }

      context[input.key] = normalized;
    }

    const missingContext = transition.requiredInputs
      .filter((input) => context[input.key] === undefined)
      .map((input) => input.label);
    if (missingContext.length > 0) {
      setEntitlementMessage(
        "Required provisioning context is missing: " + missingContext.join(", "),
      );
      return;
    }

    if (
      current.evidence === "stripe_sync" &&
      current.status !== entitlementEditor.status &&
      !entitlementEditor.acknowledgeBillingOverride
    ) {
      setEntitlementMessage(
        "Explicitly acknowledge the billing override before changing Stripe-synchronized access.",
      );
      return;
    }

    setEntitlementSaving(true);
    setEntitlementMessage(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/organizations/" +
          encodeURIComponent(selectedOrgId) +
          "/entitlements/" +
          encodeURIComponent(entitlementEditor.product),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: entitlementEditor.status,
            expectedUpdatedAt: current.updatedAt,
            notes: entitlementEditor.notes.trim() || null,
            reason: entitlementEditor.reason.trim(),
            acknowledgeBillingOverride:
              entitlementEditor.acknowledgeBillingOverride,
            context,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to update product access");
      }

      setEntitlementMessage(
        typeof body?.message === "string"
          ? body.message
          : body?.pending
            ? "Provisioning queued. Product access remains restricted until every provisioning job succeeds."
            : "Access update committed and audited.",
      );
      setEntitlementEditor(null);
      await Promise.all([
        loadAccess(selectedOrgId),
        loadOrganizations(orgQuery),
        loadCatalog(),
      ]);
    } catch (error) {
      setEntitlementMessage(
        error instanceof Error ? error.message : "Unable to update product access",
      );
    } finally {
      setEntitlementSaving(false);
      const sensitiveKeys = new Set(
        transition.requiredInputs
          .filter((input) => input.sensitive)
          .map((input) => input.key),
      );
      setEntitlementEditor((currentEditor) =>
        currentEditor
          ? {
              ...currentEditor,
              context: Object.fromEntries(
                Object.entries(currentEditor.context).map(([key, value]) => [
                  key,
                  sensitiveKeys.has(key) ? "" : value,
                ]),
              ),
            }
          : currentEditor,
      );
    }
  }


  function openReconciliationEditor(entitlement: AccessEntitlement) {
    setReconciliationEditor({
      product: entitlement.product,
      reason: "",
      context: {},
    });
    setReconciliationMessage(null);
    setEntitlementEditor(null);
  }

  async function saveReconciliation() {
    if (!access || !selectedOrgId || !reconciliationEditor) return;

    const current = access.entitlements.find(
      (item) => item.product === reconciliationEditor.product,
    );
    const reconciliation = reconciliationFor(reconciliationEditor.product);
    if (!current || !current.persisted || !current.updatedAt || !reconciliation) {
      setReconciliationMessage(
        "Refresh access evidence before reconciling this product.",
      );
      return;
    }
    if (!reconciliation.available) {
      setReconciliationMessage(
        reconciliation.reason ??
          "This provisioning lane is not available for reconciliation.",
      );
      return;
    }
    if (reconciliationEditor.reason.trim().length < 3) {
      setReconciliationMessage("An operator reason is required.");
      return;
    }

    const descriptorKeys = new Set(
      reconciliation.requiredInputs.map((input) => input.key),
    );
    const missingDescriptors = reconciliation.requiredFields.filter(
      (field) => !descriptorKeys.has(field),
    );
    if (missingDescriptors.length > 0) {
      setReconciliationMessage(
        "Provisioning input metadata is incomplete for: " +
          missingDescriptors.join(", ") +
          ". Refresh before retrying.",
      );
      return;
    }

    const context: Record<string, unknown> = {};
    for (const input of reconciliation.requiredInputs) {
      const raw = reconciliationEditor.context[input.key] ?? "";
      const normalized = input.kind === "password" ? raw : raw.trim();
      if (!normalized.length) continue;

      if (input.kind === "number") {
        const numeric = Number(normalized);
        if (!Number.isFinite(numeric)) {
          setReconciliationMessage(input.label + " must be a valid number.");
          return;
        }
        if (input.min !== undefined && numeric < input.min) {
          setReconciliationMessage(
            input.label + " must be at least " + input.min + ".",
          );
          return;
        }
        if (input.max !== undefined && numeric > input.max) {
          setReconciliationMessage(
            input.label + " must be no more than " + input.max + ".",
          );
          return;
        }
        context[input.key] = numeric;
        continue;
      }

      if (input.kind === "json") {
        try {
          const parsed = JSON.parse(normalized) as unknown;
          if (
            parsed === null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
          ) {
            setReconciliationMessage(input.label + " must be a JSON object.");
            return;
          }
          context[input.key] = parsed;
        } catch {
          setReconciliationMessage(input.label + " must contain valid JSON.");
          return;
        }
        continue;
      }

      context[input.key] = normalized;
    }

    const missingContext = reconciliation.requiredInputs
      .filter((input) => context[input.key] === undefined)
      .map((input) => input.label);
    if (missingContext.length > 0) {
      setReconciliationMessage(
        "Required provisioning context is missing: " +
          missingContext.join(", "),
      );
      return;
    }

    setReconciliationSaving(true);
    setReconciliationMessage(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/organizations/" +
          encodeURIComponent(selectedOrgId) +
          "/entitlements/" +
          encodeURIComponent(reconciliationEditor.product) +
          "/reconcile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: current.updatedAt,
            reason: reconciliationEditor.reason.trim(),
            context,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.error ?? "Unable to reconcile product provisioning",
        );
      }

      setReconciliationMessage(
        typeof body?.message === "string"
          ? body.message
          : "Provisioning reconciliation queued. Current product access was not changed.",
      );
      setReconciliationEditor(null);
      await Promise.all([
        loadAccess(selectedOrgId),
        loadOrganizations(orgQuery),
        loadCatalog(),
      ]);
    } catch (error) {
      setReconciliationMessage(
        error instanceof Error
          ? error.message
          : "Unable to reconcile product provisioning",
      );
    } finally {
      setReconciliationSaving(false);
      const sensitiveKeys = new Set(
        reconciliation.requiredInputs
          .filter((input) => input.sensitive)
          .map((input) => input.key),
      );
      setReconciliationEditor((currentEditor) =>
        currentEditor
          ? {
              ...currentEditor,
              context: Object.fromEntries(
                Object.entries(currentEditor.context).map(([key, value]) => [
                  key,
                  sensitiveKeys.has(key) ? "" : value,
                ]),
              ),
            }
          : currentEditor,
      );
    }
  }

  function editBinding(binding: Binding) {
    setBindingEditor({
      externalPriceId: binding.externalPriceId,
      product: binding.product,
      statusOnActive: binding.statusOnActive,
      notes: binding.notes ?? "",
    });
    setBindingMessage(null);
    document.getElementById("binding-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveBinding() {
    if (!bindingEditor.externalPriceId.trim()) {
      setBindingMessage("A Stripe price ID is required.");
      return;
    }
    setBindingSaving(true);
    setBindingMessage(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/catalog/bindings/" +
          encodeURIComponent(bindingEditor.externalPriceId.trim()),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: bindingEditor.product,
            statusOnActive: bindingEditor.statusOnActive,
            notes: bindingEditor.notes.trim() || null,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save price binding");
      setBindingMessage("Binding saved and audited.");
      setBindingEditor(emptyBinding);
      await loadCatalog();
    } catch (error) {
      setBindingMessage(error instanceof Error ? error.message : "Unable to save price binding");
    } finally {
      setBindingSaving(false);
    }
  }

  async function openDeadLetter(jobId: string) {
    setDeadLetterLoadingId(jobId);
    setDeadLetterError(null);
    setDeadLetterMessage(null);
    try {
      const response = await fetch(
        "/api/platform/commerce/provisioning/jobs/" +
          encodeURIComponent(jobId) +
          "/remediation",
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to inspect dead-letter recovery");
      }
      setDeadLetter(body);
    } catch (error) {
      setDeadLetter(null);
      setDeadLetterError(
        error instanceof Error ? error.message : "Unable to inspect dead-letter recovery",
      );
    } finally {
      setDeadLetterLoadingId(null);
    }
  }

  async function completeDeadLetterResolution(message: string) {
    setDeadLetterMessage(message);
    setDeadLetter(null);
    await loadCatalog();
  }

  if (loading && !catalog) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading commerce authority…
        </div>
      </div>
    );
  }

  if (!catalog) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Catalog authority unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {catalogError ?? "Platform commerce authority is required."}
        </p>
        <button
          onClick={() => void loadCatalog()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  const editingEntitlement =
    access && entitlementEditor
      ? access.entitlements.find(
          (item) => item.product === entitlementEditor.product,
        ) ?? null
      : null;
  const editingTransition = entitlementEditor
    ? transitionFor(entitlementEditor.product, entitlementEditor.status)
    : null;
  const editingTargets = entitlementEditor
    ? access?.transitions.find(
        (item) => item.product === entitlementEditor.product,
      )?.targets ?? []
    : [];
  const reconcilingEntitlement =
    access && reconciliationEditor
      ? access.entitlements.find(
          (item) => item.product === reconciliationEditor.product,
        ) ?? null
      : null;
  const editingReconciliation = reconciliationEditor
    ? reconciliationFor(reconciliationEditor.product)
    : null;
  const driftRows = catalog.provisioning.drift.rows;
  const driftAttention = driftRows.filter(
    (row) => row.classification === "active_access_needs_verification",
  );
  const driftSuperseded = driftRows.filter(
    (row) => row.classification === "superseded_by_success",
  ).length;
  const driftInactive = driftRows.filter(
    (row) => row.classification === "access_not_active",
  ).length;
  const driftUnmapped = driftRows.filter(
    (row) => row.classification === "unmapped_legacy_job",
  ).length;

  return (
    <div className="space-y-6">
      {catalog.authority.viaBootstrap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This operator session is using MigraAuth bootstrap authority. Grant a persistent platform role before removing the bootstrap path.
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Products" value={catalog.metrics.catalogProducts} detail="canonical source catalog" />
        <MetricCard label="Plans" value={catalog.metrics.catalogPlans} detail="source-controlled plans" />
        <MetricCard label="Price components" value={catalog.metrics.catalogPrices} detail="lookup-key definitions" />
        <MetricCard label="Live bindings" value={catalog.metrics.liveBindings} detail="Stripe price mappings" />
        <MetricCard label="Access rows" value={catalog.metrics.effectiveEntitlements} detail="effective entitlements" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Provisioning health</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Queue & dead-letter evidence</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Current worker health is separated from historical failures. DEAD jobs are evidence to investigate, not candidates for blind replay.
            </p>
          </div>
          <div className={"inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold " + (catalog.mutationReadiness.worker.ready ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
            <span className={"h-2 w-2 rounded-full " + (catalog.mutationReadiness.worker.ready ? "bg-emerald-500" : "bg-rose-500")} />
            {catalog.mutationReadiness.worker.ready ? "Worker healthy" : "Worker unavailable"}
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Pending" value={catalog.metrics.provisioningPending} detail="waiting for worker" />
          <MetricCard label="Running" value={catalog.metrics.provisioningRunning} detail="currently executing" />
          <MetricCard label="Succeeded" value={catalog.metrics.provisioningSucceeded} detail="completed jobs" />
          <MetricCard label="Failed" value={catalog.metrics.provisioningFailed} detail="retryable failures" />
          <MetricCard label="Dead letters" value={catalog.metrics.provisioningDead} detail="unresolved terminal failures" />
          <MetricCard label="Resolved" value={catalog.metrics.provisioningCanceled} detail="operator-canceled or superseded" />
        </div>

        {driftRows.length > 0 ? (
          <div className="border-t border-amber-100 bg-[linear-gradient(180deg,#fffbeb,#ffffff)] px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
                  <AlertTriangle size={18} />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Historical reconciliation</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">Dead provisioning vs current access</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                    Legacy dead jobs are correlated with the organization&apos;s current entitlement and later successful provisioning evidence. This is a verification queue, not an automatic revoke list.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[31rem]">
                {[
                  ["Verify", driftAttention.length],
                  ["Later success", driftSuperseded],
                  ["Inactive", driftInactive],
                  ["Unmapped", driftUnmapped],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-white/80 bg-white/80 px-3 py-2.5 shadow-sm">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {driftRows.map((row) => (
                <article key={row.orgId + ":" + (row.product ?? "legacy")} className={"rounded-2xl border p-4 " + driftClass(row.classification)}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-950">
                          {row.orgName ?? row.orgSlug ?? row.orgId}
                        </span>
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                          {driftLabel(row.classification)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-lg border border-white/80 bg-white/70 px-2 py-1 text-[10px] font-semibold">
                          {row.product ?? "unknown product"}
                        </span>
                        <span className="rounded-lg border border-white/80 bg-white/70 px-2 py-1 text-[10px] font-semibold">
                          access {row.entitlementStatus ?? "missing"}
                        </span>
                        <span className="rounded-lg border border-white/80 bg-white/70 px-2 py-1 text-[10px] font-semibold">
                          {row.deadJobs} dead job{row.deadJobs === 1 ? "" : "s"}
                        </span>
                        <span className="rounded-lg border border-white/80 bg-white/70 px-2 py-1 text-[10px] font-semibold">
                          {row.subscriptionCount} subscription{row.subscriptionCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5">
                        {row.lastDeadError ?? "No terminal error recorded."}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] opacity-80">
                        <span>Dead evidence: {formatDate(row.latestDeadAt)}</span>
                        <span>
                          Later success: {row.latestSuccessAt ? formatDate(row.latestSuccessAt) : "none"}
                        </span>
                      </div>
                    </div>
                    {row.classification === "active_access_needs_verification" ? (
                      <button
                        type="button"
                        onClick={() => void inspectDriftOrganization(row.orgId)}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-50"
                      >
                        <Layers3 size={13} /> Inspect access
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {deadLetterMessage ? (
          <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800 sm:px-6">
            {deadLetterMessage}
          </div>
        ) : null}
        {deadLetterError ? (
          <div className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-800 sm:px-6">
            {deadLetterError}
          </div>
        ) : null}

        {catalog.provisioning.deadJobs.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-5 text-sm text-slate-500 sm:px-6">
            No dead-letter provisioning jobs are recorded.
          </div>
        ) : (
          <div className="border-t border-slate-100">
            <div className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto">
              {catalog.provisioning.deadJobs.map((job) => (
                <article key={job.id} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-rose-700">DEAD</span>
                      <span className="text-xs font-semibold text-slate-900">{job.orgName ?? job.orgSlug ?? job.orgId}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{job.source}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{job.type}</span>
                    </div>
                    <p className="mt-2 break-words text-xs leading-5 text-rose-700">{job.lastError ?? "No terminal error text recorded."}</p>
                    <code className="mt-1 block truncate text-[10px] text-slate-400">{job.id}</code>
                  </div>
                  <div className="flex flex-col gap-2 text-xs text-slate-500 lg:items-end lg:text-right">
                    <div>
                      <p><span className="font-semibold text-slate-700">{job.attempts}</span> / {job.maxAttempts} attempts</p>
                      <p className="mt-1">{formatDate(job.lastErrorAt ?? job.updatedAt)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openDeadLetter(job.id)}
                      disabled={deadLetterLoadingId === job.id}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      {deadLetterLoadingId === job.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <SlidersHorizontal size={13} />
                      )}
                      Resolve
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {deadLetter ? (
        <DeadLetterRemediationPanel
          key={deadLetter.job.id}
          remediation={deadLetter}
          canManage={catalog.mutationReadiness.entitlements}
          onClose={() => setDeadLetter(null)}
          onResolved={completeDeadLetterResolution}
        />
      ) : null}

      <section className="grid gap-6 2xl:grid-cols-[1.12fr_0.88fr]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Source authority</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Canonical product catalog</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Pricing definitions are code-reviewed. This surface inspects them; it does not invent a second price database.
              </p>
            </div>
            <button
              onClick={() => void loadCatalog()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw size={15} /> Refresh
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {catalog.catalog.map((product) => {
              const expanded = expandedProduct === product.productFamily;
              const coverage = product.productKey ? coverageByProduct.get(product.productKey) : undefined;
              return (
                <article key={product.productFamily} className="p-5 sm:p-6">
                  <button
                    onClick={() => setExpandedProduct(expanded ? null : product.productFamily)}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                      <Boxes size={19} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-950">{product.name}</h3>
                        {product.productKey ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {product.productKey}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{product.description}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>{product.planCount} plans</span>
                        <span>{product.priceCount} price components</span>
                        <span>{coverage?.bindings ?? 0} live bindings</span>
                        <span>{coverage?.activeEntitlements ?? 0} active orgs</span>
                      </div>
                    </div>
                    {expanded ? <ChevronDown size={17} className="mt-3 text-slate-400" /> : <ChevronRight size={17} className="mt-3 text-slate-400" />}
                  </button>

                  {expanded ? (
                    <div className="mt-5 grid gap-3">
                      {product.plans.map((plan) => (
                        <div key={plan.planCode} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-semibold text-slate-900">{plan.name}</h4>
                                <code className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">{plan.planCode}</code>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-500">{plan.description}</p>
                            </div>
                            <span className="text-xs font-medium text-slate-500">{plan.entitlementCount} entitlements</span>
                          </div>
                          {plan.prices.length ? (
                            <div className="mt-3 grid gap-2">
                              {plan.prices.map((price) => (
                                <div key={price.lookupKey} className="grid gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                  <div className="min-w-0">
                                    <code className="block truncate text-[11px] font-semibold text-slate-700">{price.lookupKey}</code>
                                    <p className="mt-0.5 text-[10px] text-slate-400">
                                      {price.componentType} · {price.billingInterval}
                                      {price.meterName ? " · " + price.meterName : ""}
                                    </p>
                                  </div>
                                  <span className="text-xs font-semibold text-slate-800">{formatMoney(price.unitAmount)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-xs font-medium text-slate-500">No billable price component — source plan is free/internal.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <section id="binding-editor" className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Global mapping</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Stripe binding registry</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                A Stripe price ID maps to one product access lane. Global changes require MigraAuth catalog authority.
              </p>
            </div>

            <div className="space-y-4 p-5 sm:p-6">
              {!catalog.mutationReadiness.bindings ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                  You have read access only. platform.commerce.catalog.manage is required to change global mappings.
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-semibold text-slate-800">Stripe price ID</label>
                    <input
                      value={bindingEditor.externalPriceId}
                      onChange={(event) => setBindingEditor((current) => ({ ...current, externalPriceId: event.target.value }))}
                      placeholder="price_..."
                      className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-xs text-slate-900 outline-none focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-500/10"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      Product
                      <select
                        value={bindingEditor.product}
                        onChange={(event) => setBindingEditor((current) => ({ ...current, product: event.target.value as ProductKey }))}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-violet-400"
                      >
                        {PRODUCT_KEYS.map((product) => <option key={product} value={product}>{product}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Status on active subscription
                      <select
                        value={bindingEditor.statusOnActive}
                        onChange={(event) => setBindingEditor((current) => ({ ...current, statusOnActive: event.target.value as BindingEditor["statusOnActive"] }))}
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-violet-400"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="TRIAL">TRIAL</option>
                        <option value="RESTRICTED">RESTRICTED</option>
                        <option value="INTERNAL_ONLY">INTERNAL_ONLY</option>
                      </select>
                    </label>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-800">Operator note</label>
                    <textarea
                      value={bindingEditor.notes}
                      onChange={(event) => setBindingEditor((current) => ({ ...current, notes: event.target.value }))}
                      rows={2}
                      maxLength={2000}
                      placeholder="Plan/tier mapping context"
                      className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-violet-400 focus:bg-white"
                    />
                  </div>
                  {bindingMessage ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">{bindingMessage}</div>
                  ) : null}
                  <button
                    onClick={() => void saveBinding()}
                    disabled={bindingSaving}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
                  >
                    {bindingSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    {bindingSaving ? "Saving…" : "Save global binding"}
                  </button>
                </>
              )}

              <div className="border-t border-slate-100 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{catalog.bindings.length} live bindings</p>
                <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                  {catalog.bindings.map((binding) => (
                    <div key={binding.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <code className="block truncate text-[11px] font-semibold text-slate-800">{binding.externalPriceId}</code>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-semibold text-slate-600">{binding.product}</span>
                            <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(binding.statusOnActive)}>{binding.statusOnActive}</span>
                          </div>
                          {binding.notes ? <p className="mt-1.5 text-[11px] leading-5 text-slate-500">{binding.notes}</p> : null}
                        </div>
                        {catalog.mutationReadiness.bindings ? (
                          <button onClick={() => editBinding(binding)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:text-violet-700" aria-label="Edit binding">
                            <Edit3 size={13} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Runtime readiness</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Schema authority</h2>
            </div>
            <div className="space-y-3 p-5 sm:p-6">
              <ReadinessRow label="Canonical pricing" value="Source controlled" ok detail="billing-core PRODUCT_CATALOG" />
              <ReadinessRow
                label="Effective access"
                value={catalog.readiness.effectiveEntitlementAuthority ?? "Missing"}
                ok={Boolean(catalog.readiness.effectiveEntitlementAuthority)}
                detail="production enforcement source"
              />
              <ReadinessRow
                label="Native catalog mirror"
                value={catalog.readiness.nativeCatalogMirrorReady ? "Ready" : "Not deployed"}
                ok={catalog.readiness.nativeCatalogMirrorReady}
                detail="BillingProduct + BillingPrice"
              />
            </div>
          </section>
        </div>
      </section>

      <section id="organization-access" className="scroll-mt-6 rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Organization access</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Effective product access</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Search an organization to inspect the exact entitlement rows, subscriptions, and recent provisioning jobs that control access.
          </p>
          <div className="relative mt-4">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={orgQuery}
              onChange={(event) => setOrgQuery(event.target.value)}
              placeholder="Search organization name or slug…"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"
            />
            {orgLoading ? <Loader2 size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400" /> : null}
          </div>
        </div>

        <div className="grid min-h-[28rem] lg:grid-cols-[0.72fr_1.28fr]">
          <div className="border-b border-slate-100 lg:border-b-0 lg:border-r">
            {organizations.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No organizations match this search.</div>
            ) : (
              <div className="max-h-[42rem] divide-y divide-slate-100 overflow-y-auto">
                {organizations.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => void selectOrganization(org.id)}
                    className={"w-full p-4 text-left transition hover:bg-slate-50 " + (selectedOrgId === org.id ? "bg-emerald-50/70" : "")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{org.name}</p>
                        <code className="mt-1 block truncate text-[10px] text-slate-400">{org.slug}</code>
                      </div>
                      <ChevronRight size={15} className="mt-1 shrink-0 text-slate-300" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-medium text-slate-500">
                      <span>{org.activeEntitlementCount} active access</span>
                      <span>{org.subscriptionCount} subscriptions</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            {accessLoading ? (
              <div className="grid min-h-[28rem] place-items-center">
                <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" /> Loading access evidence…</div>
              </div>
            ) : accessError ? (
              <div className="p-6">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{accessError}</div>
              </div>
            ) : access ? (
              <div className="space-y-6 p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">{access.organization.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{access.organization.slug}</p>
                  </div>
                  <div className="flex max-w-xl flex-col items-start gap-2 sm:items-end">
                    <span
                      className={
                        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] " +
                        (access.worker.ready
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-800")
                      }
                    >
                      <span
                        className={
                          "h-2 w-2 rounded-full " +
                          (access.worker.ready ? "bg-emerald-500" : "bg-amber-500")
                        }
                      />
                      {access.worker.ready
                        ? "Provisioning worker live"
                        : "Provisioning worker unavailable"}
                    </span>
                    {!access.canManageEntitlements ? (
                      <p className="text-right text-xs leading-5 text-amber-800">
                        Your platform role can inspect access but cannot change entitlements.
                      </p>
                    ) : access.worker.reason ? (
                      <p className="text-right text-xs leading-5 text-slate-500">
                        {access.worker.reason}
                      </p>
                    ) : null}
                  </div>
                </div>

                {entitlementMessage ? (
                  <div
                    className={
                      "rounded-2xl border px-4 py-3 text-sm font-medium " +
                      (entitlementMessage.includes("committed")
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-900")
                    }
                  >
                    {entitlementMessage}
                  </div>
                ) : null}

                {reconciliationMessage ? (
                  <div
                    className={
                      "rounded-2xl border px-4 py-3 text-sm font-medium " +
                      (reconciliationMessage.includes("queued") &&
                      reconciliationMessage.includes("not changed")
                        ? "border-blue-200 bg-blue-50 text-blue-800"
                        : "border-amber-200 bg-amber-50 text-amber-900")
                    }
                  >
                    {reconciliationMessage}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {access.entitlements.map((entitlement) => {
                    const transitionRow = access.transitions.find(
                      (item) => item.product === entitlement.product,
                    );
                    const targets = transitionRow?.targets ?? [];
                    const reconciliation = transitionRow?.reconciliation ?? null;
                    const availableTargets = targets.filter(
                      (target) => target.available,
                    ).length;

                    return (
                      <article key={entitlement.product} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-900">{entitlement.product}</p>
                            <span className={"mt-2 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(entitlement.status)}>
                              {entitlement.status}
                            </span>
                          </div>
                          <span className={"rounded-full px-2 py-0.5 text-[9px] font-semibold " + (entitlement.persisted ? "bg-white text-slate-600" : "bg-slate-200 text-slate-500")}>
                            {entitlement.persisted ? "persisted" : "default"}
                          </span>
                        </div>
                        <div className="mt-3 space-y-1 text-[10px] leading-5 text-slate-500">
                          <p>Starts: {formatDate(entitlement.startsAt)}</p>
                          <p>Ends: {formatDate(entitlement.endsAt)}</p>
                          <p>Evidence: {entitlement.evidence.replace(/_/g, " ")}</p>
                          <p>{availableTargets} of {targets.length} target states operationally available</p>
                        </div>
                        {entitlement.notes ? <p className="mt-2 line-clamp-3 text-[10px] leading-5 text-slate-500">{entitlement.notes}</p> : null}
                        <div className="mt-3 grid gap-2">
                          <button
                            onClick={() => openEntitlementEditor(entitlement)}
                            disabled={!access.canManageEntitlements}
                            title={
                              access.canManageEntitlements
                                ? "Open access controls"
                                : "platform.commerce.entitlements.manage is required"
                            }
                            className={
                              "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition " +
                              (access.canManageEntitlements
                                ? "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                                : "cursor-not-allowed border-slate-200 bg-white text-slate-400")
                            }
                          >
                            <SlidersHorizontal size={13} /> Configure access
                          </button>
                          {entitlement.persisted &&
                          ["ACTIVE", "TRIAL", "INTERNAL_ONLY"].includes(
                            entitlement.status,
                          ) ? (
                            <button
                              onClick={() => openReconciliationEditor(entitlement)}
                              disabled={
                                !access.canManageEntitlements ||
                                !reconciliation?.available
                              }
                              title={
                                !access.canManageEntitlements
                                  ? "platform.commerce.entitlements.manage is required"
                                  : reconciliation?.available
                                    ? "Re-run downstream provisioning without changing access"
                                    : reconciliation?.reason ??
                                      "Provisioning reconciliation is unavailable"
                              }
                              className={
                                "inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition " +
                                (access.canManageEntitlements &&
                                reconciliation?.available
                                  ? "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
                                  : "cursor-not-allowed border-slate-200 bg-white text-slate-400")
                              }
                            >
                              <RotateCcw size={13} /> Reconcile provisioning
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {entitlementEditor && editingEntitlement ? (
                  <EntitlementEditorPanel
                    editor={entitlementEditor}
                    entitlement={editingEntitlement}
                    targets={editingTargets}
                    selectedTransition={editingTransition}
                    worker={access.worker}
                    saving={entitlementSaving}
                    onChange={setEntitlementEditor}
                    onCancel={() => {
                      setEntitlementEditor(null);
                      setEntitlementMessage(null);
                    }}
                    onSave={() => void saveEntitlement()}
                  />
                ) : null}

                {reconciliationEditor &&
                reconcilingEntitlement &&
                editingReconciliation ? (
                  <EntitlementReconciliationPanel
                    editor={reconciliationEditor}
                    entitlement={reconcilingEntitlement}
                    reconciliation={editingReconciliation}
                    worker={access.worker}
                    saving={reconciliationSaving}
                    onChange={setReconciliationEditor}
                    onCancel={() => {
                      setReconciliationEditor(null);
                      setReconciliationMessage(null);
                    }}
                    onSave={() => void saveReconciliation()}
                  />
                ) : null}

                <div className="grid gap-5 xl:grid-cols-2">
                  <EvidenceList
                    title="Subscriptions"
                    empty="No billing subscriptions are recorded for this organization."
                    items={access.subscriptions.map((subscription) => ({
                      id: subscription.id,
                      title: subscription.status,
                      badge: subscription.provider,
                      meta: subscription.externalSubscriptionId,
                      detail: subscription.currentPeriodEnd ? "Period ends " + formatDate(subscription.currentPeriodEnd) : "No period end recorded",
                      status: subscription.status,
                    }))}
                  />
                  <EvidenceList
                    title="Provisioning jobs"
                    empty="No provisioning jobs are recorded for this organization."
                    items={access.recentProvisioningJobs.map((job) => ({
                      id: job.id,
                      title: job.type,
                      badge: job.source,
                      meta: job.id,
                      detail: job.attempts + "/" + job.maxAttempts + " attempts · " + formatDate(job.createdAt),
                      status: job.status,
                    }))}
                  />
                </div>
              </div>
            ) : (
              <div className="grid min-h-[28rem] place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Layers3 size={21} /></span>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">Select an organization</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    The right side will show the effective access matrix, billing evidence, and provisioning state.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Deployment truth</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Commerce schema readiness</h2>
          <p className="mt-1 text-sm text-slate-600">The operator surface reports what is actually deployed instead of assuming the newest Prisma model is live.</p>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
          {Object.entries(catalog.readiness.tables).map(([name, table]) => (
            <div key={name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Database size={15} className={table.present ? "text-emerald-600" : "text-slate-400"} />
                <code className="text-xs font-semibold text-slate-800">{name}</code>
              </div>
              <p className={"mt-3 text-sm font-semibold " + (table.present ? "text-emerald-700" : "text-slate-500")}>
                {table.present ? "Deployed" : "Not deployed"}
              </p>
              <p className="mt-1 text-xs text-slate-500">{table.rows === null ? "No runtime table" : table.rows + " rows"}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DeadLetterRemediationPanel({
  remediation,
  canManage,
  onClose,
  onResolved,
}: {
  remediation: DeadLetterRemediation;
  canManage: boolean;
  onClose: () => void;
  onResolved: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [context, setContext] = useState<DeadLetterRecoveryContext>({
    domain: remediation.retry.currentContext.domain ?? "",
    tenantId: remediation.retry.currentContext.tenantId ?? "",
    serviceInstanceId: remediation.retry.currentContext.serviceInstanceId ?? "",
    targetIp: remediation.retry.currentContext.targetIp ?? "",
    plan: remediation.retry.currentContext.plan ?? "",
    mailboxEmail: remediation.retry.currentContext.mailboxEmail ?? "",
  });
  const [saving, setSaving] = useState<"retry" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostingCandidates = remediation.retry.hostingCandidates ?? [];
  const [manualHostingCandidate, setManualHostingCandidate] =
    useState<HostingRecoveryCandidate | null>(null);
  const [tenantSearchQuery, setTenantSearchQuery] = useState("");
  const [tenantSearchResults, setTenantSearchResults] = useState<
    HostingTenantSearchResult[]
  >([]);
  const [tenantSearchLoading, setTenantSearchLoading] = useState(false);
  const [tenantEvidenceLoadingId, setTenantEvidenceLoadingId] = useState<
    string | null
  >(null);
  const [tenantSearchError, setTenantSearchError] = useState<string | null>(null);
  const availableHostingCandidates = manualHostingCandidate
    ? [
        manualHostingCandidate,
        ...hostingCandidates.filter(
          (candidate) => candidate.tenantId !== manualHostingCandidate.tenantId,
        ),
      ]
    : hostingCandidates;

  function contextForHostingCandidate(
    current: DeadLetterRecoveryContext,
    candidate: HostingRecoveryCandidate,
  ): DeadLetterRecoveryContext {
    const sameTenant = current.tenantId === candidate.tenantId;
    return {
      ...current,
      tenantId: candidate.tenantId,
      domain:
        candidate.suggestedContext.domain ??
        (sameTenant ? current.domain ?? "" : ""),
      serviceInstanceId:
        candidate.suggestedContext.serviceInstanceId ??
        (sameTenant ? current.serviceInstanceId ?? "" : ""),
      targetIp:
        candidate.suggestedContext.targetIp ??
        (sameTenant ? current.targetIp ?? "" : ""),
    };
  }

  function applyHostingCandidate(candidate: HostingRecoveryCandidate) {
    setContext((current) => contextForHostingCandidate(current, candidate));
  }

  function chooseRecoveryValue(
    candidate: HostingRecoveryCandidate,
    field: "domain" | "serviceInstanceId" | "targetIp",
    value: string,
  ) {
    setContext((current) => ({
      ...contextForHostingCandidate(current, candidate),
      [field]: value,
    }));
  }

  const requiredFields = remediation.retry.requiredFields;
  const requiredInputs = remediation.retry.requiredInputs ?? [];
  const descriptorKeys = new Set(requiredInputs.map((input) => input.key));
  const missingDescriptors = requiredFields.filter(
    (field) => !descriptorKeys.has(field),
  );
  const missingFields = requiredInputs
    .filter((input) => !(context[input.key] ?? "").trim())
    .map((input) => input.label);
  const hostingSearchEnabled =
    remediation.job.productLane === "MIGRAHOSTING" && requiredFields.length > 0;

  useEffect(() => {
    if (!hostingSearchEnabled) return;

    const query = tenantSearchQuery.trim();
    if (query.length < 2) {
      setTenantSearchResults([]);
      setTenantSearchError(null);
      setTenantSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setTenantSearchLoading(true);
      setTenantSearchError(null);
      try {
        const params = new URLSearchParams({
          q: query,
          limit: "20",
        });
        const response = await fetch(
          "/api/platform/hosting/tenants?" + params.toString(),
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = await response.json();
        if (response.status === 403) {
          throw new Error(
            "Hosting read authority is required to search MigraPanel tenants.",
          );
        }
        if (!response.ok) {
          throw new Error(body.error ?? "Unable to search MigraPanel tenants");
        }
        setTenantSearchResults(
          Array.isArray(body.tenants) ? body.tenants : [],
        );
      } catch (caught) {
        if (controller.signal.aborted) return;
        setTenantSearchResults([]);
        setTenantSearchError(
          caught instanceof Error
            ? caught.message
            : "Unable to search MigraPanel tenants",
        );
      } finally {
        if (!controller.signal.aborted) setTenantSearchLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hostingSearchEnabled, tenantSearchQuery]);

  async function loadTenantRecoveryEvidence(
    tenant: HostingTenantSearchResult,
  ) {
    setTenantEvidenceLoadingId(tenant.id);
    setTenantSearchError(null);
    try {
      const response = await fetch(
        "/api/platform/hosting/tenants/" +
          encodeURIComponent(tenant.id) +
          "/recovery-context",
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.error ?? "Unable to load MigraPanel recovery evidence",
        );
      }
      const candidate = body.candidate as HostingRecoveryCandidate | undefined;
      if (!candidate || candidate.tenantId !== tenant.id) {
        throw new Error("MigraPanel returned inconsistent tenant evidence");
      }
      setManualHostingCandidate(candidate);
      applyHostingCandidate(candidate);
      setTenantSearchResults([]);
      setTenantSearchQuery("");
    } catch (caught) {
      setTenantSearchError(
        caught instanceof Error
          ? caught.message
          : "Unable to load MigraPanel recovery evidence",
      );
    } finally {
      setTenantEvidenceLoadingId(null);
    }
  }

  const retryReady =
    canManage &&
    remediation.retry.available &&
    missingDescriptors.length === 0 &&
    missingFields.length === 0 &&
    reason.trim().length >= 3 &&
    saving === null;
  const cancelReady =
    canManage &&
    remediation.cancel.available &&
    reason.trim().length >= 3 &&
    saving === null;

  async function submit(action: "retry" | "cancel") {
    setSaving(action);
    setError(null);
    try {
      const payload =
        action === "retry"
          ? {
              reason: reason.trim(),
              context: Object.fromEntries(
                Object.entries(context)
                  .map(([key, value]) => [key, value.trim()])
                  .filter(([, value]) => Boolean(value)),
              ),
            }
          : { reason: reason.trim() };

      const response = await fetch(
        "/api/platform/commerce/provisioning/jobs/" +
          encodeURIComponent(remediation.job.id) +
          "/" +
          action,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.error ??
            (action === "retry"
              ? "Unable to retry dead-letter job"
              : "Unable to cancel dead-letter job"),
        );
      }

      await onResolved(
        action === "retry"
          ? "Recovery job queued. The original dead-letter job is preserved as CANCELED."
          : "Dead-letter job canceled and retained with its failure history.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : action === "retry"
            ? "Unable to retry dead-letter job"
            : "Unable to cancel dead-letter job",
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-3xl border border-rose-200 bg-[linear-gradient(145deg,#ffffff,#fff7f7)] shadow-sm">
      <div className="flex flex-col gap-4 border-b border-rose-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
            Dead-letter remediation
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            {remediation.job.orgName ?? remediation.job.orgSlug ?? remediation.job.orgId}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold">
            <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">
              {remediation.job.status}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              {remediation.job.productLane ?? "unknown product"}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              {remediation.job.action ?? remediation.job.type}
            </span>
          </div>
          <code className="mt-2 block break-all text-[10px] text-slate-400">
            {remediation.job.id}
          </code>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving !== null}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <XCircle size={14} /> Close
        </button>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Source evidence
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <EvidenceFlag
                label="Payload hash"
                ok={remediation.retry.payloadHashValid}
              />
              <EvidenceFlag
                label="Envelope signature"
                ok={remediation.retry.signatureValid}
              />
              <EvidenceFlag
                label="Legacy malformed"
                ok={!remediation.retry.malformed}
                trueLabel="No"
                falseLabel="Yes"
              />
              <EvidenceFlag
                label="Provisioning paused"
                ok={!remediation.retry.provisioningPaused}
                trueLabel="No"
                falseLabel="Yes"
              />
            </div>
          </div>

          <div
            className={
              "rounded-2xl border p-4 " +
              (remediation.retry.worker.ready
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50")
            }
          >
            <div className="flex items-start gap-3">
              {remediation.retry.worker.ready ? (
                <ShieldCheck
                  size={17}
                  className="mt-0.5 shrink-0 text-emerald-700"
                />
              ) : (
                <AlertTriangle
                  size={17}
                  className="mt-0.5 shrink-0 text-amber-700"
                />
              )}
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  {remediation.retry.worker.ready
                    ? "Managed worker is live"
                    : "Managed worker unavailable"}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {remediation.retry.worker.ready
                    ? "A signed recovery job can enter the production provisioning queue."
                    : remediation.retry.worker.reason ??
                      "Provisioning worker health could not be verified."}
                </p>
                {remediation.retry.worker.lastSeenAt ? (
                  <p className="mt-1 text-[10px] text-slate-500">
                    Heartbeat {formatDate(remediation.retry.worker.lastSeenAt)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-xs font-semibold text-rose-950">Original failure</p>
            <p className="mt-2 break-words text-xs leading-5 text-rose-800">
              {remediation.job.lastError ?? "No terminal error text recorded."}
            </p>
            <p className="mt-2 text-[10px] text-rose-700">
              {remediation.job.attempts} / {remediation.job.maxAttempts} attempts · updated{" "}
              {formatDate(remediation.job.updatedAt)}
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {!remediation.retry.available ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={17}
                  className="mt-0.5 shrink-0 text-amber-700"
                />
                <div>
                  <p className="text-xs font-semibold text-amber-950">
                    Automatic replay is blocked
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">
                    {remediation.retry.reason ??
                      "This historical action does not have an audited replay contract."}
                  </p>
                  <p className="mt-2 text-[10px] leading-5 text-amber-700">
                    Canceling the dead letter does not erase it; it marks the incident resolved
                    while retaining the original failure evidence and audit trail.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <RotateCcw
                  size={17}
                  className="mt-0.5 shrink-0 text-blue-700"
                />
                <div>
                  <p className="text-xs font-semibold text-blue-950">
                    Signed recovery is available
                  </p>
                  <p className="mt-1 text-xs leading-5 text-blue-800">
                    Retry creates a new signed MANUAL provisioning job. The source dead letter
                    is changed to CANCELED only in the same successful database transaction.
                  </p>
                </div>
              </div>
            </div>
          )}

          {hostingSearchEnabled ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">
                Find a MigraPanel tenant
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                If automatic identity matching found nothing, search MigraPanel explicitly.
                Selecting a tenant only loads read-only recovery evidence; it does not link the
                tenant or retry the job.
              </p>
              <div className="relative mt-3">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={tenantSearchQuery}
                  onChange={(event) => setTenantSearchQuery(event.target.value)}
                  placeholder="Search tenant name, slug, domain, or company…"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-sm text-slate-900 outline-none focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-500/10"
                />
                {tenantSearchLoading ? (
                  <Loader2
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-cyan-600"
                  />
                ) : null}
              </div>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">
                Enter at least two characters. Results require Platform Hosting read authority.
              </p>

              {tenantSearchError ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {tenantSearchError}
                </div>
              ) : null}

              {tenantSearchQuery.trim().length >= 2 &&
              !tenantSearchLoading &&
              !tenantSearchError &&
              tenantSearchResults.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  No MigraPanel tenants match this search.
                </p>
              ) : null}

              {tenantSearchResults.length > 0 ? (
                <div className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {tenantSearchResults.map((tenant) => (
                    <button
                      key={tenant.id}
                      type="button"
                      onClick={() => void loadTenantRecoveryEvidence(tenant)}
                      disabled={tenantEvidenceLoadingId !== null}
                      className="flex w-full items-start gap-3 bg-white px-3 py-3 text-left transition hover:bg-cyan-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {tenant.name ?? tenant.companyName ?? tenant.slug ?? tenant.id}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                          {tenant.slug ? <span>{tenant.slug}</span> : null}
                          {tenant.domain ? <span>{tenant.domain}</span> : null}
                          <span>{tenant.websiteCount} website{tenant.websiteCount === 1 ? "" : "s"}</span>
                          <span>{tenant.status ?? "unknown status"}</span>
                        </div>
                      </div>
                      {tenantEvidenceLoadingId === tenant.id ? (
                        <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-cyan-600" />
                      ) : (
                        <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-300" />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {availableHostingCandidates.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-slate-800">
                MigraPanel recovery candidates
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Read-only tenant evidence from automatic identity matches or an explicit Hosting
                search. Nothing is linked or retried until you explicitly choose values and submit.
              </p>
              <div className="mt-3 space-y-3">
                {availableHostingCandidates.map((candidate) => (
                  <div
                    key={candidate.tenantId}
                    className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold text-slate-950">
                            {candidate.name ?? candidate.companyName ?? candidate.slug ?? candidate.tenantId}
                          </p>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-cyan-700">
                            {candidate.matchReason === "explicit_selection"
                              ? "Operator selected"
                              : candidate.matchScore + "% match"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-500">
                            {candidate.matchReason.replaceAll("_", " ")}
                          </span>
                        </div>
                        <code className="mt-1 block break-all text-[10px] text-slate-400">
                          {candidate.tenantId}
                        </code>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Status {candidate.status ?? "unknown"} · {candidate.domains.length} domain option
                          {candidate.domains.length === 1 ? "" : "s"} · {candidate.serviceInstances.length} cloudpod service instance
                          {candidate.serviceInstances.length === 1 ? "" : "s"} · {candidate.targetIps.length} target IP
                          {candidate.targetIps.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => applyHostingCandidate(candidate)}
                        disabled={!canManage || saving !== null}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Check size={13} /> Use candidate
                      </button>
                    </div>

                    {candidate.domains.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Domains
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {candidate.domains.map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => chooseRecoveryValue(candidate, "domain", value)}
                              disabled={!canManage || saving !== null}
                              className={
                                "rounded-lg border px-2 py-1 text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
                                (context.domain === value
                                  ? "border-cyan-300 bg-cyan-100 text-cyan-900"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200")
                              }
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {candidate.serviceInstances.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Cloudpod service instances
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {candidate.serviceInstances.map((instance) => (
                            <button
                              key={instance.id}
                              type="button"
                              onClick={() =>
                                chooseRecoveryValue(
                                  candidate,
                                  "serviceInstanceId",
                                  instance.id,
                                )
                              }
                              disabled={!canManage || saving !== null}
                              className={
                                "max-w-full rounded-lg border px-2 py-1 text-left text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
                                (context.serviceInstanceId === instance.id
                                  ? "border-cyan-300 bg-cyan-100 text-cyan-900"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200")
                              }
                            >
                              <span className="block max-w-[18rem] truncate font-mono">{instance.id}</span>
                              <span className="block text-[9px] text-slate-400">{instance.status}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {candidate.targetIps.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Target IP evidence
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {candidate.targetIps.map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => chooseRecoveryValue(candidate, "targetIp", value)}
                              disabled={!canManage || saving !== null}
                              className={
                                "rounded-lg border px-2 py-1 font-mono text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
                                (context.targetIp === value
                                  ? "border-cyan-300 bg-cyan-100 text-cyan-900"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-cyan-200")
                              }
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : remediation.retry.suggestionReason ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              {remediation.retry.suggestionReason}
            </div>
          ) : null}

          {requiredFields.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Recovery context
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Correct the missing or stale fields required by this specific dispatcher.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {requiredInputs.map((input) => (
                  <label
                    key={input.key}
                    className={
                      "text-xs font-semibold text-slate-700 " +
                      (input.kind === "json" ? "sm:col-span-2" : "")
                    }
                  >
                    {input.label}
                    {input.kind === "json" ? (
                      <textarea
                        rows={4}
                        value={context[input.key] ?? ""}
                        onChange={(event) =>
                          setContext((current) => ({
                            ...current,
                            [input.key]: event.target.value,
                          }))
                        }
                        placeholder={input.placeholder}
                        spellCheck={false}
                        disabled={!canManage || saving !== null}
                        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs font-normal text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100"
                      />
                    ) : (
                      <input
                        type={
                          input.kind === "email"
                            ? "email"
                            : input.kind === "password"
                              ? "password"
                              : input.kind === "number"
                                ? "number"
                                : "text"
                        }
                        min={input.kind === "number" ? input.min : undefined}
                        max={input.kind === "number" ? input.max : undefined}
                        value={context[input.key] ?? ""}
                        onChange={(event) =>
                          setContext((current) => ({
                            ...current,
                            [input.key]: event.target.value,
                          }))
                        }
                        placeholder={input.placeholder}
                        disabled={!canManage || saving !== null}
                        className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-100"
                      />
                    )}
                  </label>
                ))}
              </div>
              {missingDescriptors.length > 0 ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  Backend recovery metadata is incomplete for{" "}
                  {missingDescriptors.join(", ")}. Retry remains locked.
                </div>
              ) : null}
              {missingFields.length > 0 && remediation.retry.available ? (
                <p className="mt-2 text-[10px] font-medium text-amber-700">
                  Required before retry: {missingFields.join(", ")}.
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="block text-sm font-semibold text-slate-800">
            Operator reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Why is this dead letter being retried or canceled?"
              disabled={!canManage || saving !== null}
              className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-normal text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-500/10 disabled:bg-slate-100"
            />
            <span className="mt-1 block text-[10px] font-normal leading-5 text-slate-500">
              Required for both retry and cancel. Stored in the audit record.
            </span>
          </label>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
              {error}
            </div>
          ) : null}

          {!canManage ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              Read-only platform commerce authority. Entitlement-management permission is
              required to resolve dead letters.
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => void submit("cancel")}
              disabled={!cancelReady}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving === "cancel" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <XCircle size={15} />
              )}
              {saving === "cancel" ? "Canceling…" : "Cancel dead letter"}
            </button>
            <button
              type="button"
              onClick={() => void submit("retry")}
              disabled={!retryReady}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving === "retry" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RotateCcw size={15} />
              )}
              {saving === "retry" ? "Queueing…" : "Queue signed retry"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function EvidenceFlag({
  label,
  ok,
  trueLabel = "Valid",
  falseLabel = "Invalid",
}: {
  label: string;
  ok: boolean;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p
        className={
          "mt-1 text-xs font-semibold " +
          (ok ? "text-emerald-700" : "text-rose-700")
        }
      >
        {ok ? trueLabel : falseLabel}
      </p>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function ReadinessRow({
  label,
  value,
  detail,
  ok,
}: {
  label: string;
  value: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <span className={"mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl " + (ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
        {ok ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
      </span>
      <div>
        <p className="text-xs font-semibold text-slate-900">{label}</p>
        <p className={"mt-1 text-sm font-semibold " + (ok ? "text-emerald-700" : "text-amber-700")}>{value}</p>
        <p className="mt-1 text-[10px] leading-5 text-slate-500">{detail}</p>
      </div>
    </div>
  );
}



function EntitlementReconciliationPanel({
  editor,
  entitlement,
  reconciliation,
  worker,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  editor: ReconciliationEditorState;
  entitlement: AccessEntitlement;
  reconciliation: EntitlementReconciliation;
  worker: WorkerStatus;
  saving: boolean;
  onChange: (value: ReconciliationEditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const descriptorKeys = new Set(
    reconciliation.requiredInputs.map((input) => input.key),
  );
  const missingDescriptors = reconciliation.requiredFields.filter(
    (field) => !descriptorKeys.has(field),
  );
  const canSave =
    reconciliation.available &&
    missingDescriptors.length === 0 &&
    worker.ready &&
    !saving;

  return (
    <section className="rounded-3xl border border-blue-200 bg-[linear-gradient(145deg,#ffffff,#f3f8ff)] p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 border-b border-blue-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
            Provisioning reconciliation
          </p>
          <h4 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            {editor.product}
          </h4>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Re-run the downstream provisioning required by the current{" "}
            <span
              className={
                "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                statusClass(entitlement.status)
              }
            >
              {entitlement.status}
            </span>{" "}
            entitlement. This operation does not grant, revoke, or otherwise
            change product access.
          </p>
        </div>
        <div className="text-left sm:text-right">
          <span
            className={
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] " +
              (worker.ready
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800")
            }
          >
            <span
              className={
                "h-2 w-2 rounded-full " +
                (worker.ready ? "bg-emerald-500" : "bg-amber-500")
              }
            />
            {worker.ready ? "Worker live" : "Worker unavailable"}
          </span>
          {worker.lastSeenAt ? (
            <p className="mt-1 text-[10px] text-slate-500">
              Heartbeat {formatDate(worker.lastSeenAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className={
          "mt-5 rounded-2xl border p-4 " +
          (reconciliation.available
            ? "border-blue-200 bg-blue-50"
            : "border-amber-200 bg-amber-50")
        }
      >
        <div className="flex items-start gap-3">
          {reconciliation.available ? (
            <RotateCcw
              size={17}
              className="mt-0.5 shrink-0 text-blue-700"
            />
          ) : (
            <AlertTriangle
              size={17}
              className="mt-0.5 shrink-0 text-amber-700"
            />
          )}
          <div>
            <p className="text-xs font-semibold text-slate-900">
              {reconciliation.available
                ? "Signed provisioning replay"
                : "Reconciliation is currently blocked"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {reconciliation.available
                ? reconciliation.actions.length > 0
                  ? "The operator will queue " +
                    reconciliation.actions.join(" · ") +
                    " using the current entitlement as the source of truth."
                  : "No managed external provisioning action is required."
                : reconciliation.reason ??
                  "This provisioning lane is not operationally ready."}
            </p>
          </div>
        </div>
      </div>

      {reconciliation.requiredFields.length > 0 ? (
        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-800">
            Provisioning context
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            These values are required to re-drive the current product setup.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {reconciliation.requiredInputs.map((input) => (
              <label
                key={input.key}
                className={
                  "text-xs font-semibold text-slate-700 " +
                  (input.kind === "json" ? "sm:col-span-2" : "")
                }
              >
                {input.label}
                {input.kind === "json" ? (
                  <textarea
                    rows={4}
                    value={editor.context[input.key] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...editor,
                        context: {
                          ...editor.context,
                          [input.key]: event.target.value,
                        },
                      })
                    }
                    placeholder={input.placeholder}
                    spellCheck={false}
                    className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs font-normal text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                  />
                ) : (
                  <input
                    type={
                      input.kind === "email"
                        ? "email"
                        : input.kind === "password"
                          ? "password"
                          : input.kind === "number"
                            ? "number"
                            : "text"
                    }
                    min={input.kind === "number" ? input.min : undefined}
                    max={input.kind === "number" ? input.max : undefined}
                    autoComplete={
                      input.kind === "password" ? "new-password" : undefined
                    }
                    value={editor.context[input.key] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...editor,
                        context: {
                          ...editor.context,
                          [input.key]: event.target.value,
                        },
                      })
                    }
                    placeholder={input.placeholder}
                    className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                  />
                )}
                {input.sensitive ? (
                  <span className="mt-1 block text-[10px] font-normal leading-5 text-slate-500">
                    Sensitive value. It is cleared after submission and is
                    stored only through the encrypted provisioning-secret
                    reference path.
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          {missingDescriptors.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              Backend provisioning metadata is incomplete for{" "}
              {missingDescriptors.join(", ")}. The operation stays locked.
            </div>
          ) : null}
        </div>
      ) : null}

      <label className="mt-5 block text-sm font-semibold text-slate-800">
        Operator reason
        <textarea
          value={editor.reason}
          onChange={(event) =>
            onChange({
              ...editor,
              reason: event.target.value,
            })
          }
          rows={3}
          maxLength={500}
          placeholder="Why are you re-running provisioning for this active entitlement?"
          className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
        />
      </label>

      <div className="mt-5 rounded-2xl border border-blue-200 bg-white p-4 text-xs leading-5 text-slate-600">
        <strong className="text-slate-900">Access invariant:</strong> this
        operation queues signed provisioning jobs only. It does not update the
        entitlement status, start/end dates, billing evidence, or notes.
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RotateCcw size={15} />
          )}
          {saving ? "Queueing…" : "Queue reconciliation"}
        </button>
      </div>
    </section>
  );
}

function EntitlementEditorPanel({
  editor,
  entitlement,
  targets,
  selectedTransition,
  worker,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  editor: EntitlementEditorState;
  entitlement: AccessEntitlement;
  targets: EntitlementTransition[];
  selectedTransition: EntitlementTransition | null;
  worker: WorkerStatus;
  saving: boolean;
  onChange: (value: EntitlementEditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const requiredFields = selectedTransition?.requiredFields ?? [];
  const requiredInputs = selectedTransition?.requiredInputs ?? [];
  const descriptorKeys = new Set(requiredInputs.map((input) => input.key));
  const missingDescriptors = requiredFields.filter(
    (field) => !descriptorKeys.has(field),
  );
  const isStripeOverride =
    entitlement.evidence === "stripe_sync" &&
    entitlement.status !== editor.status;
  const canSave =
    Boolean(selectedTransition?.available) &&
    missingDescriptors.length === 0 &&
    !saving;

  return (
    <section className="rounded-3xl border border-emerald-200 bg-[linear-gradient(145deg,#ffffff,#f4fbf8)] p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 border-b border-emerald-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Access operation
          </p>
          <h4 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            {editor.product}
          </h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Current state{" "}
            <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + statusClass(entitlement.status)}>
              {entitlement.status}
            </span>
            {" · "}
            {entitlement.persisted ? "persisted entitlement" : "default restricted state"}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <span
            className={
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] " +
              (worker.ready
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800")
            }
          >
            <span
              className={
                "h-2 w-2 rounded-full " +
                (worker.ready ? "bg-emerald-500" : "bg-amber-500")
              }
            />
            {worker.ready ? "Worker live" : "Worker unavailable"}
          </span>
          {worker.lastSeenAt ? (
            <p className="mt-1 text-[10px] text-slate-500">
              Heartbeat {formatDate(worker.lastSeenAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-sm font-semibold text-slate-800">Target access state</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Only transitions the backend preflight marks operationally safe can be committed.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {targets.map((target) => {
            const selected = editor.status === target.toStatus;
            return (
              <button
                key={target.toStatus}
                type="button"
                disabled={!target.available || saving}
                onClick={() =>
                  onChange({
                    ...editor,
                    status: target.toStatus,
                  })
                }
                className={
                  "rounded-2xl border p-3 text-left transition " +
                  (selected
                    ? "border-emerald-300 bg-emerald-50 shadow-sm"
                    : target.available
                      ? "border-slate-200 bg-white hover:border-emerald-200"
                      : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(target.toStatus)}>
                    {target.toStatus}
                  </span>
                  {selected ? <Check size={14} className="text-emerald-700" /> : null}
                </div>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  {target.mode.replace("_", " ")}
                </p>
                <p className="mt-1 min-h-10 text-[10px] leading-5 text-slate-500">
                  {target.available
                    ? target.actions.length
                      ? target.actions.join(" · ")
                      : "No external provisioning action"
                    : target.reason ?? "Transition blocked"}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {selectedTransition ? (
        <div
          className={
            "mt-5 rounded-2xl border p-4 " +
            (selectedTransition.available
              ? selectedTransition.mode === "provisioning"
                ? "border-blue-200 bg-blue-50"
                : "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50")
          }
        >
          <div className="flex items-start gap-3">
            {selectedTransition.available ? (
              <ShieldCheck
                size={17}
                className={
                  selectedTransition.mode === "provisioning"
                    ? "mt-0.5 shrink-0 text-blue-700"
                    : "mt-0.5 shrink-0 text-emerald-700"
                }
              />
            ) : (
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-700" />
            )}
            <div>
              <p className="text-xs font-semibold text-slate-900">
                {selectedTransition.available
                  ? selectedTransition.mode === "provisioning"
                    ? "Signed provisioning transition"
                    : "Database-only access transition"
                  : "Transition is currently blocked"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {selectedTransition.available
                  ? selectedTransition.actions.length
                    ? "The entitlement change and signed provisioning jobs commit in one database transaction."
                    : "No external service mutation is required for this product lane."
                  : selectedTransition.reason ?? "This transition is not operationally ready."}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {requiredFields.length > 0 ? (
        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-800">Provisioning context</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            These fields were requested by the backend preflight for this exact transition.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {requiredInputs.map((input) => (
              <label
                key={input.key}
                className={
                  "text-xs font-semibold text-slate-700 " +
                  (input.kind === "json" ? "sm:col-span-2" : "")
                }
              >
                {input.label}
                {input.kind === "json" ? (
                  <textarea
                    rows={4}
                    value={editor.context[input.key] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...editor,
                        context: {
                          ...editor.context,
                          [input.key]: event.target.value,
                        },
                      })
                    }
                    placeholder={input.placeholder}
                    spellCheck={false}
                    className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs font-normal text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
                  />
                ) : (
                  <input
                    type={
                      input.kind === "email"
                        ? "email"
                        : input.kind === "password"
                          ? "password"
                          : input.kind === "number"
                            ? "number"
                            : "text"
                    }
                    min={input.kind === "number" ? input.min : undefined}
                    max={input.kind === "number" ? input.max : undefined}
                    autoComplete={
                      input.kind === "password" ? "new-password" : undefined
                    }
                    value={editor.context[input.key] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...editor,
                        context: {
                          ...editor.context,
                          [input.key]: event.target.value,
                        },
                      })
                    }
                    placeholder={input.placeholder}
                    className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
                  />
                )}
                {input.sensitive ? (
                  <span className="mt-1 block text-[10px] font-normal leading-5 text-slate-500">
                    Sensitive value. It is scrubbed from the editor after each
                    submission attempt and is never written to the durable
                    provisioning payload.
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          {missingDescriptors.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              Backend provisioning metadata is incomplete for{" "}
              {missingDescriptors.join(", ")}. The operation stays locked.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-semibold text-slate-800">
          Operator reason
          <textarea
            value={editor.reason}
            onChange={(event) =>
              onChange({
                ...editor,
                reason: event.target.value,
              })
            }
            rows={3}
            maxLength={500}
            placeholder="Why is this access change required?"
            className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-normal text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
          />
          <span className="mt-1 block text-[10px] font-normal leading-5 text-slate-500">
            Required. Stored in the audit record and provisioning payload.
          </span>
        </label>

        <label className="text-sm font-semibold text-slate-800">
          Access note
          <textarea
            value={editor.notes}
            onChange={(event) =>
              onChange({
                ...editor,
                notes: event.target.value,
              })
            }
            rows={3}
            maxLength={2000}
            placeholder="Optional operator-visible context"
            className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-normal text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
          />
          <span className="mt-1 block text-[10px] font-normal leading-5 text-slate-500">
            This becomes the persisted entitlement note.
          </span>
        </label>
      </div>

      {isStripeOverride ? (
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <input
            type="checkbox"
            checked={editor.acknowledgeBillingOverride}
            onChange={(event) =>
              onChange({
                ...editor,
                acknowledgeBillingOverride: event.target.checked,
              })
            }
            className="mt-1 accent-amber-600"
          />
          <span>
            <span className="block text-xs font-semibold text-amber-950">
              Acknowledge manual billing override
            </span>
            <span className="mt-1 block text-xs leading-5 text-amber-800">
              This entitlement contains Stripe synchronization evidence. A manual state change can diverge from billing until the next synchronization.
            </span>
          </span>
        </label>
      ) : null}

      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-emerald-100 pt-5 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {saving
            ? "Committing…"
            : selectedTransition?.mode === "provisioning"
              ? "Commit & queue provisioning"
              : "Commit access change"}
        </button>
      </div>
    </section>
  );
}

function EvidenceList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ id: string; title: string; badge: string; meta: string; detail: string; status: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      </div>
      {items.length === 0 ? (
        <p className="p-4 text-xs leading-5 text-slate-500">{empty}</p>
      ) : (
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {items.map((item) => (
            <div key={item.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-900">{item.title}</span>
                <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(item.status)}>{item.status}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-500">{item.badge}</span>
              </div>
              <code className="mt-2 block truncate text-[10px] text-slate-400">{item.meta}</code>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">{item.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
