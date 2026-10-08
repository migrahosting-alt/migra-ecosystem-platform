import { requirePermission } from "@migrateck/auth-client";
import { BriefcaseBusiness, Building2, ShieldCheck } from "lucide-react";
import { MembersWorkspace } from "@/components/platform/MembersWorkspace";
import { PlatformOperatorAccessWorkspace } from "@/components/platform/PlatformOperatorAccessWorkspace";
import { WorkforceAccessWorkspace } from "@/components/platform/WorkforceAccessWorkspace";
import { PlatformEmptyState } from "@/components/platform/PlatformEmptyState";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");
  const hasOrganization = Boolean(session.activeOrgId && session.activeOrgName);

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Organization / Authority"
        title="Members & Access"
        description="Manage three deliberately separate authority planes: tenant membership, MigraTeck Workforce identity/product access, and MigraTeck-wide operator authority issued by MigraAuth."
      />

      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 size={18} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
                Organization access
              </p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">
                Tenant-scoped membership
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                OWNER, ADMIN, BILLING_ADMIN, and MEMBER apply only inside one
                organization. They never grant MigraTeck-wide operator power.
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-cyan-200 bg-[linear-gradient(135deg,#ffffff,#ecfeff)] p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-100 text-cyan-800">
              <BriefcaseBusiness size={18} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800">
                Workforce access
              </p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">
                Staff identity & product roles
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Canonical staff IDs, employment lifecycle, manager hierarchy,
                and downstream product-role grants live in MigraAuth Workforce.
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-violet-200 bg-[linear-gradient(135deg,#ffffff,#f5f3ff)] p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
              <ShieldCheck size={18} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
                Platform operator access
              </p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">
                MigraTeck-wide authority
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                SUPPORT, OPERATOR, and OWNER are independent MigraAuth platform
                grants. Only platform OWNER may decide who receives them.
              </p>
            </div>
          </div>
        </article>
      </div>

      <section className="mb-8">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
            Organization membership plane
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
            {hasOrganization
              ? "Members in " + session.activeOrgName
              : "Select an organization"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Customer and internal-team membership stays scoped to the active
            organization and cannot widen platform operator authority.
          </p>
        </div>

        {hasOrganization ? (
          <>
            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <PlatformStatCard
                label="Active organization"
                value={session.activeOrgName!}
                detail="This is the tenant boundary currently applied to the platform session."
              />
              <PlatformStatCard
                label="Your organization role"
                value={session.activeOrgRole ?? "No role"}
                detail="Organization roles control only this tenant's membership and workflows."
              />
              <PlatformStatCard
                label="Application access"
                value={session.permissions.length + " perms"}
                detail="Current application permissions are separate from MigraAuth platform-operator grants shown below."
              />
            </div>

            <MembersWorkspace
              orgId={session.activeOrgId!}
              orgName={session.activeOrgName!}
              canManageMembers={
                session.permissions.includes("orgs.manage") ||
                ["OWNER", "ADMIN"].includes(session.activeOrgRole ?? "")
              }
              currentUserEmail={session.email}
              {...(session.displayName
                ? { currentUserName: session.displayName }
                : {})}
              {...(session.activeOrgRole
                ? { currentUserRole: session.activeOrgRole }
                : {})}
            />
          </>
        ) : (
          <PlatformEmptyState
            title="No active organization selected"
            description="Choose an organization before managing tenant members. MigraTeck operator authority remains available below because it is not organization-scoped."
            actionLabel="Go to organizations"
            actionHref="/platform/organizations"
          />
        )}
      </section>

      <section className="mb-8">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            Workforce authority plane
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
            MigraTeck staff identities & downstream product roles
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
            Workforce authority is global to the company, not scoped to a customer
            organization. Staff employment state and downstream product roles are
            managed here and provisioned by MigraAuth.
          </p>
        </div>
        <WorkforceAccessWorkspace />
      </section>

      <PlatformOperatorAccessWorkspace />
    </div>
  );
}
