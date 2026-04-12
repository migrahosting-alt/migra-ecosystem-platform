import { redirect } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { listRetentionPolicies } from "@/lib/retention";
import { listAuditRetentionRules } from "@/lib/audit-rules";
import { getBackupSummary } from "@/lib/backup-validation";
import { getIncidentSummary } from "@/lib/compliance-runbooks";
import { getEnvironmentSummary } from "@/lib/environment";

const sevColors: Record<string, string> = {
  SEV1: "bg-red-100 text-red-800",
  SEV2: "bg-orange-100 text-orange-800",
  SEV3: "bg-yellow-100 text-yellow-800",
  SEV4: "bg-gray-100 text-gray-700",
};

export default async function ComplianceDashboardPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);
  if (!ctx || !can(ctx.role, "compliance:read")) redirect("/app");

  const [retPolicies, auditRules, backupSummary, incidentSummary, envSummary] = await Promise.all([
    listRetentionPolicies(ctx.orgId),
    listAuditRetentionRules(),
    getBackupSummary(),
    getIncidentSummary(),
    getEnvironmentSummary(),
  ]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Enterprise Compliance Dashboard</h1>

      {/* ── Overview Cards ───────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Active Incidents</p>
          <p className="text-2xl font-bold">{incidentSummary.activeCount}</p>
          <p className="text-xs text-gray-400">
            {incidentSummary.open} open, {incidentSummary.investigating} investigating
          </p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Backups</p>
          <p className="text-2xl font-bold">{backupSummary.total}</p>
          <p className="text-xs text-green-600">{backupSummary.verified} verified</p>
          {backupSummary.failed > 0 && (
            <p className="text-xs text-red-600">{backupSummary.failed} failed</p>
          )}
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Retention Policies</p>
          <p className="text-2xl font-bold">{retPolicies.length}</p>
          <p className="text-xs text-gray-400">active</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Environments</p>
          <p className="text-2xl font-bold">{envSummary.total}</p>
          <p className="text-xs text-gray-400">
            {Object.entries(envSummary.byTier)
              .map(([tier, count]) => `${count} ${tier.toLowerCase()}`)
              .join(", ")}
          </p>
        </div>
      </div>

      {/* ── Incident Severity Distribution ────────────────── */}
      {incidentSummary.bySeverity.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Incidents by Severity</h2>
          <div className="flex gap-3">
            {incidentSummary.bySeverity.map((s) => (
              <span key={s.severity} className={`px-3 py-1 rounded text-sm font-medium ${sevColors[s.severity] ?? "bg-gray-100"}`}>
                {s.severity}: {s.count}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Audit Immutability Rules ─────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Audit Immutability Rules</h2>
        {auditRules.length === 0 ? (
          <p className="text-gray-500 text-sm">No immutability rules configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Entity</th>
                  <th className="py-2 pr-4">Min Retention</th>
                  <th className="py-2 pr-4">Prevent Delete</th>
                  <th className="py-2 pr-4">Prevent Modify</th>
                  <th className="py-2 pr-4">Active</th>
                </tr>
              </thead>
              <tbody>
                {auditRules.map((rule) => (
                  <tr key={rule.id} className="border-b">
                    <td className="py-2 pr-4 font-medium">{rule.name}</td>
                    <td className="py-2 pr-4">{rule.entityType}</td>
                    <td className="py-2 pr-4">{rule.minRetentionDays}d</td>
                    <td className="py-2 pr-4">{rule.preventDeletion ? "✓" : "—"}</td>
                    <td className="py-2 pr-4">{rule.preventModification ? "✓" : "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={rule.isActive ? "text-green-600" : "text-gray-400"}>
                        {rule.isActive ? "Active" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Retention Policies ───────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Retention Policies</h2>
        {retPolicies.length === 0 ? (
          <p className="text-gray-500 text-sm">No retention policies configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Entity Type</th>
                  <th className="py-2 pr-4">Retention</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Scope</th>
                  <th className="py-2 pr-4">Last Execution</th>
                </tr>
              </thead>
              <tbody>
                {retPolicies.map((policy) => (
                  <tr key={policy.id} className="border-b">
                    <td className="py-2 pr-4 font-medium">{policy.entityType}</td>
                    <td className="py-2 pr-4">{policy.retentionDays} days</td>
                    <td className="py-2 pr-4">{policy.action}</td>
                    <td className="py-2 pr-4">{policy.scope}</td>
                    <td className="py-2 pr-4 text-gray-500">
                      {policy.executions[0]
                        ? `${policy.executions[0].recordsAffected} records (${new Date(policy.executions[0].startedAt).toLocaleDateString()})`
                        : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Backup Summary by Type ───────────────────────── */}
      {backupSummary.byType.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Backup History by Type</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {backupSummary.byType.map((bt) => (
              <div key={bt.type} className="bg-white rounded border p-3">
                <p className="text-sm font-medium">{bt.type}</p>
                <p className="text-lg font-bold">{bt.count}</p>
                <p className="text-xs text-gray-400">
                  Last: {bt.lastCompleted ? new Date(bt.lastCompleted).toLocaleDateString() : "N/A"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Environment Configs ──────────────────────────── */}
      {envSummary.configs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Environment Configs</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Tier</th>
                  <th className="py-2 pr-4">Isolation</th>
                  <th className="py-2 pr-4">Default</th>
                  <th className="py-2 pr-4">Allowed Orgs</th>
                </tr>
              </thead>
              <tbody>
                {envSummary.configs.map((env) => (
                  <tr key={env.id} className="border-b">
                    <td className="py-2 pr-4 font-medium">{env.name}</td>
                    <td className="py-2 pr-4">{env.tier}</td>
                    <td className="py-2 pr-4">{env.isolationLevel}</td>
                    <td className="py-2 pr-4">{env.isDefault ? "✓" : "—"}</td>
                    <td className="py-2 pr-4">{env.orgCount === 0 ? "All" : env.orgCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
