"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  Check,
  Clipboard,
  Edit3,
  Eye,
  FilePlus2,
  Inbox,
  Loader2,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

type IntakeFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "checkbox"
  | "select"
  | "date";

type IntakeField = {
  key: string;
  label: string;
  type: IntakeFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

type NativeStatus = {
  authority: {
    roles: string[];
    permissions: string[];
  };
  readiness: {
    ready: boolean;
    tables: {
      IntakeForm: boolean;
      IntakeSubmission: boolean;
    };
    encryptionConfigured: boolean;
  };
};

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  authOrganizationId: string | null;
  intakeEntitlementStatus: string | null;
  formCount: number;
  activeFormCount: number;
  submissionCount: number;
};

type IntakeForm = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  publicKey: string;
  schemaJson: { fields: IntakeField[] };
  settingsJson: {
    successMessage?: string;
    notificationEmail?: string | null;
  };
  createdAt: string;
  updatedAt: string;
  submissionCount: number;
  newSubmissionCount: number;
  lastSubmissionAt: string | null;
};

type FormsPayload = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string | null;
  };
  forms: IntakeForm[];
};

type SubmissionSummary = {
  id: string;
  orgId: string;
  formId: string;
  status: "NEW" | "IN_REVIEW" | "RESOLVED" | "SPAM";
  source: string;
  metadataJson: {
    request_id?: string | null;
    origin?: string | null;
    fingerprint_hash?: string | null;
  };
  submittedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedById: string | null;
};

type SubmissionDetail = {
  id: string;
  orgId: string;
  formId: string;
  status: SubmissionSummary["status"];
  source: string;
  metadata: Record<string, unknown>;
  submittedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedById: string | null;
  formName: string;
  formSlug: string;
  organizationName: string;
  organizationSlug: string;
  responses: Record<string, unknown>;
};

type EditorState = {
  mode: "create" | "edit";
  formId: string | null;
  expectedUpdatedAt: string | null;
  name: string;
  slug: string;
  status: IntakeForm["status"];
  fields: IntakeField[];
  successMessage: string;
  notificationEmail: string;
};

const EMPTY_EDITOR: EditorState = {
  mode: "create",
  formId: null,
  expectedUpdatedAt: null,
  name: "",
  slug: "",
  status: "DRAFT",
  fields: [
    {
      key: "email",
      label: "Email",
      type: "email",
      required: true,
      placeholder: "you@example.com",
    },
    {
      key: "message",
      label: "Message",
      type: "textarea",
      required: true,
      placeholder: "How can we help?",
    },
  ],
  successMessage: "Thank you. Your response was received.",
  notificationEmail: "",
};

const FIELD_TYPES: IntakeFieldType[] = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "checkbox",
  "select",
  "date",
];

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function statusClass(status: string) {
  if (["ACTIVE", "RESOLVED"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["DRAFT", "NEW"].includes(status)) return "bg-blue-50 text-blue-700";
  if (["PAUSED", "IN_REVIEW"].includes(status)) return "bg-amber-50 text-amber-700";
  if (["ARCHIVED", "SPAM"].includes(status)) return "bg-slate-100 text-slate-600";
  return "bg-slate-100 text-slate-600";
}

function slugFromName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cloneEditor(): EditorState {
  return {
    ...EMPTY_EDITOR,
    fields: EMPTY_EDITOR.fields.map((field) => ({ ...field })),
  };
}

export function IntakeNativeWorkspace() {
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orgQuery, setOrgQuery] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const [formsData, setFormsData] = useState<FormsPayload | null>(null);
  const [formsLoading, setFormsLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState>(() => cloneEditor());
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionDetail, setSubmissionDetail] = useState<SubmissionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submissionBusy, setSubmissionBusy] = useState<string | null>(null);

  const canManage = status?.authority.permissions.includes("platform.intake.manage") ?? false;
  const canReadSubmissions =
    status?.authority.permissions.includes("platform.intake.submissions.read") ?? false;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/intake/native/status", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load tenant-native Intake status");
      setStatus(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load tenant-native Intake status");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadOrganizations = useCallback(async (query = "") => {
    setOrgLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(
        "/api/platform/intake/native/organizations?" + params.toString(),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load organizations");
      setOrganizations(body.organizations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load organizations");
    } finally {
      setOrgLoading(false);
    }
  }, []);

  const loadForms = useCallback(async (orgId: string) => {
    setFormsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/intake/native/organizations/" +
          encodeURIComponent(orgId) +
          "/forms",
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load Intake forms");
      setFormsData(body);
      if (
        selectedFormId &&
        !(body.forms as IntakeForm[]).some((form) => form.id === selectedFormId)
      ) {
        setSelectedFormId(null);
        setSubmissions([]);
        setSubmissionDetail(null);
      }
    } catch (err) {
      setFormsData(null);
      setError(err instanceof Error ? err.message : "Unable to load Intake forms");
    } finally {
      setFormsLoading(false);
    }
  }, [selectedFormId]);

  const loadSubmissions = useCallback(async (formId: string) => {
    if (!canReadSubmissions) return;
    setSubmissionsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/intake/native/forms/" +
          encodeURIComponent(formId) +
          "/submissions?limit=100",
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load submissions");
      setSubmissions(body.submissions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load submissions");
    } finally {
      setSubmissionsLoading(false);
    }
  }, [canReadSubmissions]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.readiness.ready) return;
    const timer = window.setTimeout(() => {
      void loadOrganizations(orgQuery);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [status?.readiness.ready, orgQuery, loadOrganizations]);

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId],
  );

  const selectedForm = useMemo(
    () => formsData?.forms.find((form) => form.id === selectedFormId) ?? null,
    [formsData, selectedFormId],
  );

  async function selectOrganization(org: OrganizationSummary) {
    setSelectedOrgId(org.id);
    setEditorOpen(false);
    setEditor(cloneEditor());
    setSelectedFormId(null);
    setSubmissions([]);
    setSubmissionDetail(null);
    if (org.intakeEntitlementStatus && ["ACTIVE", "TRIAL", "INTERNAL_ONLY"].includes(org.intakeEntitlementStatus)) {
      await loadForms(org.id);
    } else {
      setFormsData(null);
    }
  }

  function beginCreate() {
    setEditor(cloneEditor());
    setEditorOpen(true);
  }

  function beginEdit(form: IntakeForm) {
    setEditor({
      mode: "edit",
      formId: form.id,
      expectedUpdatedAt: form.updatedAt,
      name: form.name,
      slug: form.slug,
      status: form.status,
      fields: (form.schemaJson?.fields ?? []).map((field) => ({ ...field })),
      successMessage:
        form.settingsJson?.successMessage ?? "Thank you. Your response was received.",
      notificationEmail: form.settingsJson?.notificationEmail ?? "",
    });
    setEditorOpen(true);
    window.setTimeout(
      () => document.getElementById("intake-native-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      10,
    );
  }

  function updateField(index: number, patch: Partial<IntakeField>) {
    setEditor((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    }));
  }

  function addField() {
    setEditor((current) => ({
      ...current,
      fields: [
        ...current.fields,
        {
          key: "field_" + (current.fields.length + 1),
          label: "New field",
          type: "text",
          required: false,
        },
      ],
    }));
  }

  function removeField(index: number) {
    setEditor((current) => ({
      ...current,
      fields: current.fields.filter((_, fieldIndex) => fieldIndex !== index),
    }));
  }

  async function saveForm() {
    if (!selectedOrgId || !editor.name.trim() || !editor.slug.trim()) {
      setError("Organization, form name, and slug are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = {
        name: editor.name.trim(),
        slug: editor.slug.trim(),
        schema: { fields: editor.fields },
        settings: {
          successMessage: editor.successMessage.trim() || undefined,
          notificationEmail: editor.notificationEmail.trim() || null,
        },
      };

      const create = editor.mode === "create";
      const endpoint = create
        ? "/api/platform/intake/native/organizations/" +
          encodeURIComponent(selectedOrgId) +
          "/forms"
        : "/api/platform/intake/native/forms/" +
          encodeURIComponent(editor.formId!);

      const response = await fetch(endpoint, {
        method: create ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          create
            ? body
            : {
                ...body,
                expectedUpdatedAt: editor.expectedUpdatedAt,
                status: editor.status,
              },
        ),
      });
      const responseBody = await response.json();
      if (!response.ok) throw new Error(responseBody.error ?? "Unable to save Intake form");

      setEditorOpen(false);
      setEditor(cloneEditor());
      await loadForms(selectedOrgId);
      await loadOrganizations(orgQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save Intake form");
    } finally {
      setSaving(false);
    }
  }

  async function setFormStatus(form: IntakeForm, nextStatus: IntakeForm["status"]) {
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/intake/native/forms/" + encodeURIComponent(form.id),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: form.updatedAt,
            status: nextStatus,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to change form status");
      if (selectedOrgId) await loadForms(selectedOrgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change form status");
    }
  }

  async function copyPublicUrl(form: IntakeForm) {
    const path = "/api/intake/forms/" + encodeURIComponent(form.publicKey);
    const value = window.location.origin + path;
    await navigator.clipboard.writeText(value);
    setCopiedKey(form.id);
    window.setTimeout(() => setCopiedKey(null), 1600);
  }

  async function selectFormForSubmissions(form: IntakeForm) {
    setSelectedFormId(form.id);
    setSubmissionDetail(null);
    await loadSubmissions(form.id);
  }

  async function openSubmission(submissionId: string) {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/intake/native/submissions/" +
          encodeURIComponent(submissionId),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load submission");
      setSubmissionDetail(body.submission);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load submission");
    } finally {
      setDetailLoading(false);
    }
  }

  async function setSubmissionStatus(
    submissionId: string,
    nextStatus: SubmissionSummary["status"],
  ) {
    setSubmissionBusy(submissionId);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/intake/native/submissions/" +
          encodeURIComponent(submissionId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to change submission status");
      if (selectedFormId) await loadSubmissions(selectedFormId);
      if (submissionDetail?.id === submissionId) {
        await openSubmission(submissionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change submission status");
    } finally {
      setSubmissionBusy(null);
    }
  }

  if (statusLoading && !status) {
    return (
      <section className="grid min-h-64 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-violet-600" />
          Loading tenant-native Intake…
        </div>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Tenant-native Intake unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "MigraTeck platform operator authority is required."}
        </p>
        <button
          onClick={() => void loadStatus()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_10%_10%,rgba(124,58,237,.08),transparent_32%),linear-gradient(135deg,#ffffff,#f8fafc)] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className={"rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] " + (status.readiness.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                {status.readiness.ready ? "Tenant runtime ready" : "Schema not deployed"}
              </span>
              <span className={"rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] " + (status.readiness.encryptionConfigured ? "bg-violet-50 text-violet-700" : "bg-rose-50 text-rose-700")}>
                {status.readiness.encryptionConfigured ? "Payload encryption ready" : "Encryption key missing"}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">
              Tenant-native Intake control
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Forms and submissions are isolated by organization. Submission answers are encrypted before persistence and require separate sensitive-data authority to read.
            </p>
          </div>
          <div className="grid min-w-60 grid-cols-2 gap-2">
            <ReadinessStat
              label="Forms table"
              ok={status.readiness.tables.IntakeForm}
            />
            <ReadinessStat
              label="Submissions table"
              ok={status.readiness.tables.IntakeSubmission}
            />
          </div>
        </div>
      </section>

      {!status.readiness.ready || !status.readiness.encryptionConfigured ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <LockKeyhole size={19} className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Tenant-native writes are not ready
              </h3>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                The operator surface stays fail-closed until both database tables and the server-side encryption key are present.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <div className="grid gap-6 2xl:grid-cols-[0.72fr_1.28fr]">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                Organizations
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">
                Intake tenants
              </h3>
              <div className="relative mt-4">
                <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={orgQuery}
                  onChange={(event) => setOrgQuery(event.target.value)}
                  placeholder="Search organization or slug…"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm text-slate-800 outline-none focus:border-violet-400 focus:bg-white"
                />
                {orgLoading ? (
                  <Loader2 size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
                ) : null}
              </div>
            </div>
            <div className="max-h-[44rem] divide-y divide-slate-100 overflow-y-auto">
              {organizations.map((org) => {
                const enabled =
                  org.intakeEntitlementStatus &&
                  ["ACTIVE", "TRIAL", "INTERNAL_ONLY"].includes(
                    org.intakeEntitlementStatus,
                  );
                return (
                  <button
                    key={org.id}
                    onClick={() => void selectOrganization(org)}
                    className={
                      "w-full p-4 text-left transition hover:bg-slate-50 " +
                      (selectedOrgId === org.id ? "bg-violet-50/70" : "")
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {org.name}
                        </p>
                        <code className="mt-1 block truncate text-[10px] text-slate-400">
                          {org.slug}
                        </code>
                      </div>
                      <span className={"shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold " + (enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                        {org.intakeEntitlementStatus ?? "NOT ENABLED"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                      <span>{org.activeFormCount} active forms</span>
                      <span>{org.submissionCount} submissions</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                    Form operations
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    {selectedOrg?.name ?? "Select an Intake-enabled organization"}
                  </h3>
                </div>
                {canManage && selectedOrg && formsData ? (
                  <button
                    onClick={beginCreate}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    <FilePlus2 size={15} /> Create form
                  </button>
                ) : null}
              </div>

              {!selectedOrg ? (
                <EmptyState
                  icon={<Plus size={20} />}
                  title="Choose an organization"
                  description="Select a tenant on the left to manage its Intake forms."
                />
              ) : !selectedOrg.intakeEntitlementStatus ||
                !["ACTIVE", "TRIAL", "INTERNAL_ONLY"].includes(
                  selectedOrg.intakeEntitlementStatus,
                ) ? (
                <EmptyState
                  icon={<LockKeyhole size={20} />}
                  title="MigraIntake is not enabled"
                  description="Commercial entitlement must be active before tenant-native forms can be created or served."
                />
              ) : formsLoading ? (
                <div className="grid min-h-48 place-items-center text-sm text-slate-500">
                  <span className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Loading forms…
                  </span>
                </div>
              ) : !formsData || formsData.forms.length === 0 ? (
                <EmptyState
                  icon={<Inbox size={20} />}
                  title="No tenant-native forms yet"
                  description="Create the first organization-scoped form. The legacy global projects remain separate."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {formsData.forms.map((form) => (
                    <article key={form.id} className="p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-slate-950">
                              {form.name}
                            </h4>
                            <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(form.status)}>
                              {form.status}
                            </span>
                          </div>
                          <code className="mt-1 block text-[10px] text-slate-400">
                            {form.slug} · {form.publicKey}
                          </code>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>{form.schemaJson?.fields?.length ?? 0} fields</span>
                            <span>{form.submissionCount} submissions</span>
                            <span>{form.newSubmissionCount} new</span>
                            <span>Last {formatDate(form.lastSubmissionAt)}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => void copyPublicUrl(form)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {copiedKey === form.id ? <Check size={13} /> : <Clipboard size={13} />}
                            {copiedKey === form.id ? "Copied" : "Public endpoint"}
                          </button>
                          {canReadSubmissions ? (
                            <button
                              onClick={() => void selectFormForSubmissions(form)}
                              className="inline-flex items-center gap-2 rounded-xl border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              <Eye size={13} /> Submissions
                            </button>
                          ) : null}
                          {canManage ? (
                            <button
                              onClick={() => beginEdit(form)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 size={13} /> Edit
                            </button>
                          ) : null}
                          {canManage && form.status !== "ACTIVE" && form.status !== "ARCHIVED" ? (
                            <button
                              onClick={() => void setFormStatus(form, "ACTIVE")}
                              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                            >
                              <Play size={13} /> Activate
                            </button>
                          ) : null}
                          {canManage && form.status === "ACTIVE" ? (
                            <button
                              onClick={() => void setFormStatus(form, "PAUSED")}
                              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                            >
                              <Pause size={13} /> Pause
                            </button>
                          ) : null}
                          {canManage && form.status !== "ARCHIVED" ? (
                            <button
                              onClick={() => void setFormStatus(form, "ARCHIVED")}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                            >
                              <Archive size={13} /> Archive
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {editorOpen ? (
              <section id="intake-native-editor" className="rounded-3xl border border-violet-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                      {editor.mode === "create" ? "New tenant form" : "Edit tenant form"}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">
                      Form definition
                    </h3>
                  </div>
                  <button
                    onClick={() => setEditorOpen(false)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                    aria-label="Close form editor"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="space-y-5 p-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      Form name
                      <input
                        value={editor.name}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            name: event.target.value,
                            ...(current.mode === "create" &&
                            (!current.slug ||
                              current.slug === slugFromName(current.name))
                              ? { slug: slugFromName(event.target.value) }
                              : {}),
                          }))
                        }
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-normal outline-none focus:border-violet-400 focus:bg-white"
                      />
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Slug
                      <input
                        value={editor.slug}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            slug: slugFromName(event.target.value),
                          }))
                        }
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-xs font-normal outline-none focus:border-violet-400 focus:bg-white"
                      />
                    </label>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">
                          Fields
                        </h4>
                        <p className="mt-1 text-xs text-slate-500">
                          Unknown submission keys are rejected by the API.
                        </p>
                      </div>
                      <button
                        onClick={addField}
                        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                      >
                        <Plus size={13} /> Add field
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      {editor.fields.map((field, index) => (
                        <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr_0.7fr_auto]">
                            <input
                              value={field.label}
                              onChange={(event) =>
                                updateField(index, {
                                  label: event.target.value,
                                  ...(field.key.startsWith("field_")
                                    ? { key: slugFromName(event.target.value).replace(/-/g, "_") }
                                    : {}),
                                })
                              }
                              placeholder="Field label"
                              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
                            />
                            <input
                              value={field.key}
                              onChange={(event) =>
                                updateField(index, {
                                  key: event.target.value
                                    .replace(/[^a-zA-Z0-9_.-]/g, "")
                                    .slice(0, 80),
                                })
                              }
                              placeholder="field_key"
                              className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs outline-none focus:border-violet-400"
                            />
                            <select
                              value={field.type}
                              onChange={(event) =>
                                updateField(index, {
                                  type: event.target.value as IntakeFieldType,
                                  ...(event.target.value !== "select"
                                    ? { options: [] }
                                    : {}),
                                })
                              }
                              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-400"
                            >
                              {FIELD_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => removeField(index)}
                              className="grid h-10 w-10 place-items-center rounded-xl border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                              aria-label="Remove field"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                            {field.type === "select" ? (
                              <input
                                value={(field.options ?? []).join(", ")}
                                onChange={(event) =>
                                  updateField(index, {
                                    options: event.target.value
                                      .split(",")
                                      .map((value) => value.trim())
                                      .filter(Boolean),
                                  })
                                }
                                placeholder="Options, comma separated"
                                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-400"
                              />
                            ) : (
                              <input
                                value={field.placeholder ?? ""}
                                onChange={(event) =>
                                  updateField(index, {
                                    placeholder: event.target.value,
                                  })
                                }
                                placeholder="Optional placeholder"
                                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-400"
                              />
                            )}
                            <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                              <input
                                type="checkbox"
                                checked={Boolean(field.required)}
                                onChange={(event) =>
                                  updateField(index, {
                                    required: event.target.checked,
                                  })
                                }
                                className="accent-violet-600"
                              />
                              Required
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">
                      Success message
                      <textarea
                        rows={3}
                        value={editor.successMessage}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            successMessage: event.target.value,
                          }))
                        }
                        className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-normal outline-none focus:border-violet-400 focus:bg-white"
                      />
                    </label>
                    <label className="text-sm font-semibold text-slate-800">
                      Notification email
                      <input
                        value={editor.notificationEmail}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            notificationEmail: event.target.value,
                          }))
                        }
                        placeholder="ops@example.com"
                        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-normal outline-none focus:border-violet-400 focus:bg-white"
                      />
                      <span className="mt-1 block text-[11px] font-normal leading-5 text-slate-500">
                        Stored as routing configuration; notification delivery will use the Platform mail service.
                      </span>
                    </label>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => void saveForm()}
                      disabled={saving}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      {saving
                        ? "Saving…"
                        : editor.mode === "create"
                          ? "Create draft form"
                          : "Save form"}
                    </button>
                    <button
                      onClick={() => setEditorOpen(false)}
                      className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {selectedForm && canReadSubmissions ? (
              <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                      Encrypted submissions
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">
                      {selectedForm.name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Metadata loads separately from decrypted answer content.
                    </p>
                  </div>
                  <button
                    onClick={() => void loadSubmissions(selectedForm.id)}
                    disabled={submissionsLoading}
                    className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"
                    aria-label="Refresh submissions"
                  >
                    <RefreshCw size={15} className={submissionsLoading ? "animate-spin" : ""} />
                  </button>
                </div>

                <div className="grid min-h-[24rem] lg:grid-cols-[0.82fr_1.18fr]">
                  <div className="border-b border-slate-100 lg:border-b-0 lg:border-r">
                    {submissions.length === 0 ? (
                      <div className="p-5 text-sm text-slate-500">
                        No submissions recorded yet.
                      </div>
                    ) : (
                      <div className="max-h-[38rem] divide-y divide-slate-100 overflow-y-auto">
                        {submissions.map((submission) => (
                          <button
                            key={submission.id}
                            onClick={() => void openSubmission(submission.id)}
                            className={
                              "w-full p-4 text-left hover:bg-slate-50 " +
                              (submissionDetail?.id === submission.id
                                ? "bg-blue-50/70"
                                : "")
                            }
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(submission.status)}>
                                  {submission.status}
                                </span>
                                <p className="mt-2 text-xs font-semibold text-slate-800">
                                  {formatDate(submission.submittedAt)}
                                </p>
                              </div>
                              <Eye size={14} className="mt-1 text-slate-300" />
                            </div>
                            <code className="mt-2 block truncate text-[10px] text-slate-400">
                              {submission.id}
                            </code>
                            {submission.metadataJson?.origin ? (
                              <p className="mt-1 truncate text-[10px] text-slate-500">
                                {submission.metadataJson.origin}
                              </p>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    {detailLoading ? (
                      <div className="grid min-h-[24rem] place-items-center text-sm text-slate-500">
                        <span className="flex items-center gap-2">
                          <Loader2 size={16} className="animate-spin" />
                          Decrypting submission…
                        </span>
                      </div>
                    ) : submissionDetail ? (
                      <div className="space-y-5 p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(submissionDetail.status)}>
                                {submissionDetail.status}
                              </span>
                              <span className="text-xs text-slate-500">
                                {formatDate(submissionDetail.submittedAt)}
                              </span>
                            </div>
                            <code className="mt-2 block break-all text-[10px] text-slate-400">
                              {submissionDetail.id}
                            </code>
                          </div>
                          {canManage ? (
                            <select
                              value={submissionDetail.status}
                              disabled={submissionBusy === submissionDetail.id}
                              onChange={(event) =>
                                void setSubmissionStatus(
                                  submissionDetail.id,
                                  event.target.value as SubmissionSummary["status"],
                                )
                              }
                              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none"
                            >
                              <option value="NEW">NEW</option>
                              <option value="IN_REVIEW">IN REVIEW</option>
                              <option value="RESOLVED">RESOLVED</option>
                              <option value="SPAM">SPAM</option>
                            </select>
                          ) : null}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <ShieldCheck size={15} className="text-emerald-600" />
                            <h4 className="text-sm font-semibold text-slate-900">
                              Decrypted answers
                            </h4>
                          </div>
                          <div className="mt-3 space-y-3">
                            {Object.entries(submissionDetail.responses).map(
                              ([key, value]) => (
                                <div
                                  key={key}
                                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                                >
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                    {key}
                                  </p>
                                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                                    {typeof value === "string"
                                      ? value
                                      : JSON.stringify(value)}
                                  </p>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <EmptyState
                        icon={<LockKeyhole size={20} />}
                        title="Select a submission"
                        description="Decryption happens only after an operator with sensitive submission authority requests a specific record."
                      />
                    )}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadinessStat({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className={"mt-1 text-sm font-semibold " + (ok ? "text-emerald-700" : "text-amber-700")}>
        {ok ? "Ready" : "Pending"}
      </p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-48 place-items-center p-7 text-center">
      <div>
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-500">
          {icon}
        </span>
        <h4 className="mt-3 text-sm font-semibold text-slate-900">{title}</h4>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}
