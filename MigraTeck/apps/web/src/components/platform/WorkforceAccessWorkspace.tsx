"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  Clock3,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserRound,
  UserRoundCheck,
  UserRoundCog,
  UserRoundX,
  Users,
  X,
} from "lucide-react";

type Product =
  | "frendelo"
  | "migrateck"
  | "migrahosting"
  | "migrapanel"
  | "pale"
  | "migramail"
  | "migravoice"
  | "migradrive"
  | "migrapilot"
  | "migraintake"
  | "migremarket"
  | "migrainvoice"
  | "migrabuilder";

type Authority = {
  user_id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
};

type ProductAccess = {
  grant_id: string;
  product: Product;
  role_key: string;
  granted_at?: string | null;
  expires_at: string | null;
  revoked_at?: string | null;
  provisioning_state: "pending" | "synced" | "error";
  last_provisioned_at: string | null;
  last_provision_error: string | null;
  revision: number;
};

type StaffSummary = {
  staff_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  identity_status: string;
  employment_status: "invited" | "active" | "leave" | "suspended" | "terminated";
  employment_type: "employee" | "contractor" | "intern" | "vendor";
  job_title: string | null;
  department: string | null;
  team: string | null;
  manager_staff_id: string | null;
  entitlement_revision: number;
  last_login_at: string | null;
  product_access: ProductAccess[];
};

type StaffDetail = StaffSummary & {
  starts_at: string | null;
  ends_at: string | null;
  email_verified_at: string | null;
  direct_reports: Array<{
    staff_id: string;
    job_title: string | null;
    employment_status: string;
  }>;
  created_at: string;
  updated_at: string;
};

type WorkforcePayload = {
  operator: boolean;
  canRead: boolean;
  canManageWorkforce: boolean;
  canManageProductAccess: boolean;
  authority: Authority | null;
  total: number;
  staff: StaffSummary[];
};

const PRODUCTS: Array<{ value: Product; label: string }> = [
  { value: "frendelo", label: "Frendelo" },
  { value: "migrateck", label: "MigraTeck" },
  { value: "migrahosting", label: "MigraHosting" },
  { value: "migrapanel", label: "MigraPanel" },
  { value: "pale", label: "Pale" },
  { value: "migramail", label: "MigraMail" },
  { value: "migravoice", label: "MigraVoice" },
  { value: "migradrive", label: "MigraDrive" },
  { value: "migrapilot", label: "BoAI" },
  { value: "migraintake", label: "MigraIntake" },
  { value: "migremarket", label: "MigraMarket" },
  { value: "migrainvoice", label: "MigraInvoice" },
  { value: "migrabuilder", label: "MigraBuilder" },
];

const EMPLOYMENT_TYPES = [
  ["employee", "Employee"],
  ["contractor", "Contractor"],
  ["intern", "Intern"],
  ["vendor", "Vendor"],
] as const;

type CreateState = {
  email: string;
  displayName: string;
  employmentType: "employee" | "contractor" | "intern" | "vendor";
  jobTitle: string;
  department: string;
  team: string;
  managerStaffId: string;
  startsAt: string;
  reason: string;
  confirmation: string;
};

const EMPTY_CREATE: CreateState = {
  email: "",
  displayName: "",
  employmentType: "employee",
  jobTitle: "",
  department: "",
  team: "",
  managerStaffId: "",
  startsAt: "",
  reason: "",
  confirmation: "",
};

type GrantState = {
  product: Product;
  roleKey: string;
  expiresAt: string;
  reason: string;
  confirmation: string;
};

const EMPTY_GRANT: GrantState = {
  product: "migrateck",
  roleKey: "",
  expiresAt: "",
  reason: "",
  confirmation: "",
};

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/10";

type LifecycleAction = "suspend" | "reactivate" | "terminate";

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function titleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function employmentClass(status: string) {
  if (status === "active") return "bg-emerald-50 text-emerald-700";
  if (status === "invited") return "bg-blue-50 text-blue-700";
  if (status === "suspended") return "bg-amber-50 text-amber-800";
  if (status === "terminated") return "bg-rose-50 text-rose-700";
  if (status === "leave") return "bg-violet-50 text-violet-700";
  return "bg-slate-100 text-slate-600";
}

function provisioningClass(status: string) {
  if (status === "synced") return "bg-emerald-50 text-emerald-700";
  if (status === "error") return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-800";
}

function requiredGrantConfirmation(product: Product, roleKey: string) {
  return product === "frendelo" && roleKey.trim() === "super_admin"
    ? "GRANT FRENDELO SUPER ADMIN"
    : "GRANT PRODUCT ACCESS";
}

function lifecycleConfirmation(action: LifecycleAction) {
  if (action === "suspend") return "SUSPEND STAFF";
  if (action === "reactivate") return "REACTIVATE STAFF";
  return "TERMINATE STAFF";
}

export function WorkforceAccessWorkspace() {
  const [data, setData] = useState<WorkforcePayload | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState<CreateState>(EMPTY_CREATE);
  const [createPending, setCreatePending] = useState(false);

  const [grantState, setGrantState] = useState<GrantState>(EMPTY_GRANT);
  const [grantPending, setGrantPending] = useState(false);

  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleTyped, setLifecycleTyped] = useState("");
  const [lifecyclePending, setLifecyclePending] = useState(false);

  const [revokeGrant, setRevokeGrant] = useState<ProductAccess | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeTyped, setRevokeTyped] = useState("");
  const [revokePending, setRevokePending] = useState(false);

  const loadDirectory = useCallback(
    async (search: string, background = false) => {
      if (background) setListRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50", offset: "0" });
        if (search.trim()) params.set("q", search.trim());
        const response = await fetch(
          "/api/platform/workforce?" + params.toString(),
          { cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "Unable to load MigraTeck Workforce.");
        }
        setData(body);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load MigraTeck Workforce.",
        );
      } finally {
        setLoading(false);
        setListRefreshing(false);
      }
    },
    [],
  );

  const loadDetail = useCallback(async (staffId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/workforce/" + encodeURIComponent(staffId),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load staff identity.");
      }
      setDetail(body.staff ?? null);
    } catch (detailError) {
      setError(
        detailError instanceof Error
          ? detailError.message
          : "Unable to load staff identity.",
      );
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectory("");
  }, [loadDirectory]);

  useEffect(() => {
    if (!data?.canRead) return;
    const timer = window.setTimeout(() => {
      void loadDirectory(query, true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, data?.canRead, loadDirectory]);

  useEffect(() => {
    if (selectedStaffId) {
      void loadDetail(selectedStaffId);
    } else {
      setDetail(null);
    }
  }, [selectedStaffId, loadDetail]);

  const metrics = useMemo(() => {
    const staff = data?.staff ?? [];
    return {
      active: staff.filter((item) => item.employment_status === "active").length,
      invited: staff.filter((item) => item.employment_status === "invited").length,
      suspended: staff.filter((item) => item.employment_status === "suspended").length,
      provisioningErrors: staff.reduce(
        (count, item) =>
          count +
          item.product_access.filter(
            (grant) => grant.provisioning_state === "error",
          ).length,
        0,
      ),
    };
  }, [data?.staff]);

  async function createStaff() {
    setCreatePending(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/platform/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createState.email.trim(),
          ...(createState.displayName.trim()
            ? { display_name: createState.displayName.trim() }
            : {}),
          employment_type: createState.employmentType,
          ...(createState.jobTitle.trim()
            ? { job_title: createState.jobTitle.trim() }
            : {}),
          ...(createState.department.trim()
            ? { department: createState.department.trim() }
            : {}),
          ...(createState.team.trim()
            ? { team: createState.team.trim() }
            : {}),
          ...(createState.managerStaffId.trim()
            ? { manager_staff_id: createState.managerStaffId.trim() }
            : {}),
          ...(createState.startsAt
            ? { starts_at: new Date(createState.startsAt).toISOString() }
            : {}),
          reason: createState.reason.trim(),
          confirmation: createState.confirmation.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to create staff identity.");
      }

      setMessage(
        "Staff identity " +
          String(body.staff_id ?? "") +
          " was created and the invitation flow was started.",
      );
      setCreateState(EMPTY_CREATE);
      setCreateOpen(false);
      await loadDirectory(query, true);
      if (body.staff_id) setSelectedStaffId(String(body.staff_id));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create staff identity.",
      );
    } finally {
      setCreatePending(false);
    }
  }

  async function grantProductAccess() {
    if (!detail) return;
    setGrantPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/platform/workforce/" +
          encodeURIComponent(detail.staff_id) +
          "/product-access",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: grantState.product,
            role_key: grantState.roleKey.trim(),
            reason: grantState.reason.trim(),
            ...(grantState.expiresAt
              ? { expires_at: new Date(grantState.expiresAt).toISOString() }
              : {}),
            confirmation: grantState.confirmation.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to grant product access.");
      }
      setMessage(
        titleCase(grantState.product) +
          " / " +
          grantState.roleKey.trim() +
          " was granted. Provisioning state: " +
          String(body.provisioning_state ?? "pending") +
          ".",
      );
      setGrantState(EMPTY_GRANT);
      await Promise.all([
        loadDetail(detail.staff_id),
        loadDirectory(query, true),
      ]);
    } catch (grantError) {
      setError(
        grantError instanceof Error
          ? grantError.message
          : "Unable to grant product access.",
      );
    } finally {
      setGrantPending(false);
    }
  }

  async function revokeProductAccess() {
    if (!detail || !revokeGrant) return;
    setRevokePending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/platform/workforce/" +
          encodeURIComponent(detail.staff_id) +
          "/product-access/" +
          encodeURIComponent(revokeGrant.grant_id),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: revokeReason.trim(),
            confirmation: revokeTyped.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to revoke product access.");
      }
      setMessage(
        titleCase(revokeGrant.product) +
          " / " +
          revokeGrant.role_key +
          " was revoked and downstream deprovisioning was queued.",
      );
      setRevokeGrant(null);
      setRevokeReason("");
      setRevokeTyped("");
      await Promise.all([
        loadDetail(detail.staff_id),
        loadDirectory(query, true),
      ]);
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Unable to revoke product access.",
      );
    } finally {
      setRevokePending(false);
    }
  }

  async function runLifecycleAction() {
    if (!detail || !lifecycleAction) return;
    setLifecyclePending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/platform/workforce/" +
          encodeURIComponent(detail.staff_id) +
          "/" +
          lifecycleAction,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: lifecycleReason.trim(),
            confirmation: lifecycleTyped.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          body.error ?? "Unable to change the staff lifecycle state.",
        );
      }

      setMessage(
        detail.email +
          " was " +
          (lifecycleAction === "suspend"
            ? "suspended"
            : lifecycleAction === "reactivate"
              ? "reactivated"
              : "terminated") +
          ".",
      );
      setLifecycleAction(null);
      setLifecycleReason("");
      setLifecycleTyped("");
      await Promise.all([
        loadDetail(detail.staff_id),
        loadDirectory(query, true),
      ]);
    } catch (lifecycleError) {
      setError(
        lifecycleError instanceof Error
          ? lifecycleError.message
          : "Unable to change the staff lifecycle state.",
      );
    } finally {
      setLifecyclePending(false);
    }
  }

  if (loading && !data) {
    return (
      <section className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-cyan-600" />
          Loading MigraTeck Workforce…
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Workforce control unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">{error}</p>
        <button
          onClick={() => void loadDirectory(query)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  if (!data?.operator || !data.canRead) {
    return (
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            MigraTeck workforce plane
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
            Staff authority is separate
          </h2>
        </div>
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[auto_1fr]">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
            <BriefcaseBusiness size={21} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              This identity does not have Workforce directory authority.
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Customer organization membership and generic platform operator roles
              do not automatically grant staff-directory access. Workforce is the
              canonical MigraTeck employment and downstream-product authority plane.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const selectedSummary =
    data.staff.find((item) => item.staff_id === selectedStaffId) ?? null;

  return (
    <section
      id="migrateck-workforce-access"
      className="space-y-6 rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fafc)] p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            MigraTeck workforce plane
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
            Workforce identity & product authority
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            One canonical staff identity, one immutable Staff ID, and explicit
            downstream product-role grants. Employment lifecycle and product
            authority are audited independently from customer organizations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void loadDirectory(query, true)}
            disabled={listRefreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              size={15}
              className={listRefreshing ? "animate-spin" : ""}
            />
            Refresh
          </button>
          {data.canManageWorkforce ? (
            <button
              onClick={() => setCreateOpen((current) => !current)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-700 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800"
            >
              {createOpen ? <X size={15} /> : <Plus size={15} />}
              {createOpen ? "Close form" : "Create staff"}
            </button>
          ) : null}
        </div>
      </div>

      {data.authority?.via_bootstrap ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Bootstrap platform authority is active</p>
            <p className="mt-1 text-xs leading-5">
              This operator is still receiving authority from the bootstrap
              allowlist. Persist OWNER authority before retiring the bootstrap path.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <WorkforceMetric
          label="Canonical staff"
          value={String(data.total)}
          detail="MigraAuth Workforce profiles"
          icon={<Users size={17} />}
        />
        <WorkforceMetric
          label="Active in view"
          value={String(metrics.active)}
          detail="Employment status active"
          icon={<UserRoundCheck size={17} />}
        />
        <WorkforceMetric
          label="Invited"
          value={String(metrics.invited)}
          detail="Invitation not yet activated"
          icon={<Clock3 size={17} />}
        />
        <WorkforceMetric
          label="Suspended"
          value={String(metrics.suspended)}
          detail="Contained identities in current view"
          icon={<CircleOff size={17} />}
        />
        <WorkforceMetric
          label="Provisioning errors"
          value={String(metrics.provisioningErrors)}
          detail="Product grants needing attention"
          icon={<ShieldAlert size={17} />}
        />
      </div>

      {createOpen && data.canManageWorkforce ? (
        <div className="rounded-3xl border border-cyan-200 bg-cyan-50/40 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
                New workforce identity
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">
                Create staff and send invitation
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Creation establishes the canonical MigraAuth identity and immutable
                Staff ID. Product access is granted separately after the invitation.
              </p>
            </div>
            <button
              onClick={() => setCreateOpen(false)}
              className="rounded-lg p-2 text-slate-500 hover:bg-white"
              aria-label="Close create staff form"
            >
              <X size={17} />
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Email">
              <input
                value={createState.email}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                type="email"
                placeholder="staff@migrateck.com"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Display name">
              <input
                value={createState.displayName}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                placeholder="Full name"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Employment type">
              <select
                value={createState.employmentType}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    employmentType: event.target.value as CreateState["employmentType"],
                  }))
                }
                className={INPUT_CLASS}
              >
                {EMPLOYMENT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Job title">
              <input
                value={createState.jobTitle}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    jobTitle: event.target.value,
                  }))
                }
                placeholder="Support Engineer"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Department">
              <input
                value={createState.department}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    department: event.target.value,
                  }))
                }
                placeholder="Operations"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Team">
              <input
                value={createState.team}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    team: event.target.value,
                  }))
                }
                placeholder="Customer Platform"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Manager Staff ID">
              <input
                value={createState.managerStaffId}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    managerStaffId: event.target.value,
                  }))
                }
                placeholder="Optional mt_staff_..."
                className={INPUT_CLASS + " font-mono text-xs"}
              />
            </Field>
            <Field label="Start date/time">
              <input
                value={createState.startsAt}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    startsAt: event.target.value,
                  }))
                }
                type="datetime-local"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Operator reason">
              <input
                value={createState.reason}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="Why this staff identity is required"
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <Field label="Type CREATE STAFF to confirm">
              <input
                value={createState.confirmation}
                onChange={(event) =>
                  setCreateState((current) => ({
                    ...current,
                    confirmation: event.target.value,
                  }))
                }
                placeholder="CREATE STAFF"
                className={INPUT_CLASS + " font-mono text-xs"}
              />
            </Field>
            <button
              onClick={() => void createStaff()}
              disabled={
                createPending ||
                createState.confirmation.trim() !== "CREATE STAFF"
              }
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-700 px-5 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-40"
            >
              {createPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plus size={15} />
              )}
              Create & invite
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-[36rem] overflow-hidden rounded-3xl border border-slate-200 bg-white xl:grid-cols-[0.76fr_1.24fr]">
        <div className="border-b border-slate-100 xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-100 p-4">
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search staff, email, title, department…"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-500/10"
              />
              {listRefreshing ? (
                <Loader2
                  size={15}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                />
              ) : null}
            </div>
          </div>

          <div className="max-h-[48rem] divide-y divide-slate-100 overflow-y-auto">
            {data.staff.length === 0 ? (
              <div className="p-6 text-sm leading-6 text-slate-500">
                No staff identities match this search.
              </div>
            ) : (
              data.staff.map((staff) => {
                const selected = staff.staff_id === selectedStaffId;
                const errorCount = staff.product_access.filter(
                  (grant) => grant.provisioning_state === "error",
                ).length;
                return (
                  <button
                    key={staff.staff_id}
                    onClick={() => setSelectedStaffId(staff.staff_id)}
                    className={
                      "w-full p-4 text-left transition hover:bg-slate-50 " +
                      (selected ? "bg-cyan-50/70" : "")
                    }
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                        <UserRound size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {staff.display_name ?? staff.email}
                          </p>
                          <span
                            className={
                              "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] " +
                              employmentClass(staff.employment_status)
                            }
                          >
                            {staff.employment_status}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {staff.email}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
                          <span>{staff.job_title ?? titleCase(staff.employment_type)}</span>
                          <span>{staff.product_access.length} product roles</span>
                          {errorCount ? (
                            <span className="font-semibold text-rose-600">
                              {errorCount} provisioning error{errorCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <ChevronRight size={15} className="mt-2 shrink-0 text-slate-300" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="min-w-0">
          {detailLoading ? (
            <div className="grid min-h-[36rem] place-items-center">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={17} className="animate-spin" />
                Loading staff authority…
              </div>
            </div>
          ) : detail ? (
            <div className="space-y-6 p-5 sm:p-6">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold tracking-tight text-slate-950">
                      {detail.display_name ?? detail.email}
                    </h3>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] " +
                        employmentClass(detail.employment_status)
                      }
                    >
                      {detail.employment_status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{detail.email}</p>
                  <code className="mt-2 block text-[11px] text-slate-400">
                    {detail.staff_id}
                  </code>
                </div>

                {data.canManageWorkforce ? (
                  <div className="flex flex-wrap gap-2">
                    {detail.employment_status === "suspended" ? (
                      <button
                        onClick={() => setLifecycleAction("reactivate")}
                        className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        <UserRoundCheck size={14} /> Reactivate
                      </button>
                    ) : detail.employment_status !== "terminated" ? (
                      <button
                        onClick={() => setLifecycleAction("suspend")}
                        className="inline-flex items-center gap-2 rounded-xl border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                      >
                        <UserRoundX size={14} /> Suspend
                      </button>
                    ) : null}
                    {detail.employment_status !== "terminated" ? (
                      <button
                        onClick={() => setLifecycleAction("terminate")}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 size={14} /> Terminate
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {lifecycleAction ? (
                <ConfirmationPanel
                  title={
                    lifecycleAction === "suspend"
                      ? "Suspend staff identity"
                      : lifecycleAction === "reactivate"
                        ? "Reactivate staff identity"
                        : "Terminate staff identity"
                  }
                  warning={
                    lifecycleAction === "terminate"
                      ? "Termination contains identity and all renewable/product authority. This is the strongest staff lifecycle action."
                      : lifecycleAction === "suspend"
                        ? "Suspension contains staff access without deleting history."
                        : "Reactivation restores the employment lifecycle but downstream product grants still follow their own state."
                  }
                  confirmation={lifecycleConfirmation(lifecycleAction)}
                  reason={lifecycleReason}
                  typed={lifecycleTyped}
                  pending={lifecyclePending}
                  onReason={setLifecycleReason}
                  onTyped={setLifecycleTyped}
                  onCancel={() => {
                    setLifecycleAction(null);
                    setLifecycleReason("");
                    setLifecycleTyped("");
                  }}
                  onConfirm={() => void runLifecycleAction()}
                  destructive={lifecycleAction === "terminate"}
                />
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniField
                  label="Employment"
                  value={titleCase(detail.employment_type)}
                />
                <MiniField label="Job title" value={detail.job_title ?? "Not set"} />
                <MiniField
                  label="Department / team"
                  value={[detail.department, detail.team].filter(Boolean).join(" / ") || "Not set"}
                />
                <MiniField
                  label="Manager"
                  value={detail.manager_staff_id ?? "No manager assigned"}
                  mono={Boolean(detail.manager_staff_id)}
                />
                <MiniField
                  label="Identity status"
                  value={titleCase(detail.identity_status)}
                />
                <MiniField
                  label="Email verification"
                  value={detail.email_verified_at ? "Verified" : "Pending"}
                />
                <MiniField
                  label="Entitlement revision"
                  value={"#" + detail.entitlement_revision}
                />
                <MiniField
                  label="Last login"
                  value={formatDate(detail.last_login_at)}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Product authority
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-slate-900">
                      Active downstream roles
                    </h4>
                  </div>
                  <span className="text-xs font-medium text-slate-500">
                    {detail.product_access.length} active grant{detail.product_access.length === 1 ? "" : "s"}
                  </span>
                </div>

                {detail.product_access.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    No active product-role grants.
                  </p>
                ) : (
                  <div className="mt-4 grid gap-3">
                    {detail.product_access.map((grant) => (
                      <div
                        key={grant.grant_id}
                        className="rounded-xl border border-slate-200 bg-white p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {PRODUCTS.find((item) => item.value === grant.product)?.label ??
                                  titleCase(grant.product)}
                              </span>
                              <code className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                {grant.role_key}
                              </code>
                              <span
                                className={
                                  "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] " +
                                  provisioningClass(grant.provisioning_state)
                                }
                              >
                                {grant.provisioning_state}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                              <span>Revision {grant.revision}</span>
                              <span>Expires {formatDate(grant.expires_at)}</span>
                              <span>Provisioned {formatDate(grant.last_provisioned_at)}</span>
                            </div>
                            {grant.last_provision_error ? (
                              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">
                                {grant.last_provision_error}
                              </p>
                            ) : null}
                          </div>
                          {data.canManageProductAccess ? (
                            <button
                              onClick={() => {
                                setRevokeGrant(grant);
                                setRevokeReason("");
                                setRevokeTyped("");
                              }}
                              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 size={13} /> Revoke
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {revokeGrant ? (
                <ConfirmationPanel
                  title={
                    "Revoke " +
                    titleCase(revokeGrant.product) +
                    " / " +
                    revokeGrant.role_key
                  }
                  warning="This revokes the workforce grant and queues downstream deprovisioning. Employment status is not changed."
                  confirmation="REVOKE PRODUCT ACCESS"
                  reason={revokeReason}
                  typed={revokeTyped}
                  pending={revokePending}
                  onReason={setRevokeReason}
                  onTyped={setRevokeTyped}
                  onCancel={() => {
                    setRevokeGrant(null);
                    setRevokeReason("");
                    setRevokeTyped("");
                  }}
                  onConfirm={() => void revokeProductAccess()}
                  destructive
                />
              ) : null}

              {data.canManageProductAccess &&
              detail.employment_status !== "terminated" ? (
                <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">
                      Grant product role
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Product access is append-only authority history. Revocation
                      creates a new revision instead of deleting the grant.
                    </p>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Product">
                      <select
                        value={grantState.product}
                        onChange={(event) =>
                          setGrantState((current) => ({
                            ...current,
                            product: event.target.value as Product,
                            confirmation: "",
                          }))
                        }
                        className={INPUT_CLASS}
                      >
                        {PRODUCTS.map((product) => (
                          <option key={product.value} value={product.value}>
                            {product.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Role key">
                      <input
                        value={grantState.roleKey}
                        onChange={(event) =>
                          setGrantState((current) => ({
                            ...current,
                            roleKey: event.target.value
                              .toLowerCase()
                              .replace(/\s+/g, "_"),
                            confirmation: "",
                          }))
                        }
                        placeholder="support_agent"
                        className={INPUT_CLASS + " font-mono text-xs"}
                      />
                    </Field>
                    <Field label="Optional expiry">
                      <input
                        value={grantState.expiresAt}
                        onChange={(event) =>
                          setGrantState((current) => ({
                            ...current,
                            expiresAt: event.target.value,
                          }))
                        }
                        type="datetime-local"
                        className={INPUT_CLASS}
                      />
                    </Field>
                    <Field label="Operator reason">
                      <input
                        value={grantState.reason}
                        onChange={(event) =>
                          setGrantState((current) => ({
                            ...current,
                            reason: event.target.value,
                          }))
                        }
                        placeholder="Why this product role is required"
                        className={INPUT_CLASS}
                      />
                    </Field>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                    <Field
                      label={
                        "Type " +
                        requiredGrantConfirmation(
                          grantState.product,
                          grantState.roleKey,
                        ) +
                        " to confirm"
                      }
                    >
                      <input
                        value={grantState.confirmation}
                        onChange={(event) =>
                          setGrantState((current) => ({
                            ...current,
                            confirmation: event.target.value,
                          }))
                        }
                        placeholder={requiredGrantConfirmation(
                          grantState.product,
                          grantState.roleKey,
                        )}
                        className={INPUT_CLASS + " font-mono text-xs"}
                      />
                    </Field>
                    <button
                      onClick={() => void grantProductAccess()}
                      disabled={
                        grantPending ||
                        grantState.confirmation.trim() !==
                          requiredGrantConfirmation(
                            grantState.product,
                            grantState.roleKey,
                          )
                      }
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-40"
                    >
                      {grantPending ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <KeyRound size={15} />
                      )}
                      Grant product role
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <Users size={15} className="text-blue-600" />
                    <h4 className="text-sm font-semibold text-slate-900">
                      Direct reports
                    </h4>
                  </div>
                  {detail.direct_reports.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">
                      No direct reports assigned.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {detail.direct_reports.map((report) => (
                        <div
                          key={report.staff_id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <code className="text-[10px] font-semibold text-slate-700">
                            {report.staff_id}
                          </code>
                          <p className="mt-1 text-xs text-slate-500">
                            {report.job_title ?? "No title"} ·{" "}
                            {titleCase(report.employment_status)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <BadgeCheck size={15} className="text-emerald-600" />
                    <h4 className="text-sm font-semibold text-slate-900">
                      Identity evidence
                    </h4>
                  </div>
                  <div className="mt-3 space-y-2 text-xs text-slate-500">
                    <p>Created: {formatDate(detail.created_at)}</p>
                    <p>Updated: {formatDate(detail.updated_at)}</p>
                    <p>Starts: {formatDate(detail.starts_at)}</p>
                    <p>Ends: {formatDate(detail.ends_at)}</p>
                    <p>User ID: <code>{detail.user_id}</code></p>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedSummary ? (
            <div className="grid min-h-[36rem] place-items-center p-8 text-center">
              <div>
                <Loader2 size={20} className="mx-auto animate-spin text-cyan-600" />
                <p className="mt-3 text-sm text-slate-500">
                  Loading {selectedSummary.email}…
                </p>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[36rem] place-items-center p-8 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                  <UserRoundCog size={21} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">
                  Select a staff identity
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  Inspect employment state, product roles, provisioning evidence,
                  manager hierarchy, and lifecycle controls.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function WorkforceMetric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </p>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function MiniField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p
        className={
          "mt-1 break-words text-xs font-semibold text-slate-800 " +
          (mono ? "font-mono" : "")
        }
      >
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function ConfirmationPanel({
  title,
  warning,
  confirmation,
  reason,
  typed,
  pending,
  onReason,
  onTyped,
  onCancel,
  onConfirm,
  destructive = false,
}: {
  title: string;
  warning: string;
  confirmation: string;
  reason: string;
  typed: string;
  pending: boolean;
  onReason: (value: string) => void;
  onTyped: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const ready = reason.trim().length >= 10 && typed.trim() === confirmation;
  return (
    <div
      className={
        "rounded-2xl border p-4 " +
        (destructive
          ? "border-rose-200 bg-rose-50/60"
          : "border-amber-200 bg-amber-50/60")
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl " +
            (destructive
              ? "bg-rose-100 text-rose-700"
              : "bg-amber-100 text-amber-800")
          }
        >
          {destructive ? <ShieldAlert size={16} /> : <AlertTriangle size={16} />}
        </span>
        <div>
          <h4 className="text-sm font-semibold text-slate-950">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">{warning}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Field label="Operator reason">
          <input
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            placeholder="At least 10 characters"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label={"Type " + confirmation + " to confirm"}>
          <input
            value={typed}
            onChange={(event) => onTyped(event.target.value)}
            placeholder={confirmation}
            className={INPUT_CLASS + " font-mono text-xs"}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={pending}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={pending || !ready}
          className={
            "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 " +
            (destructive
              ? "bg-rose-700 hover:bg-rose-800"
              : "bg-amber-700 hover:bg-amber-800")
          }
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : destructive ? (
            <ShieldAlert size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
          Confirm action
        </button>
      </div>
    </div>
  );
}
