import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getSession } from "../lib/auth";
import { panelExec } from "../lib/db";
import { loadSettingsData } from "../lib/modules/settings";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { DataTable, StatusPill } from "../components/DataTable";
import { Toggle, PrimaryButton, DeleteButton } from "../components/InlineForm";

export const dynamic = "force-dynamic";

async function toggleFeatureFlag(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const enable = String(formData.get("enable") || "false") === "true";
  if (!id) return;
  try {
    await panelExec(`UPDATE feature_flags SET enabled = $1 WHERE id = $2`, [enable, id]);
  } catch {
    /* swallow — UI will reload and reflect actual state */
  }
  revalidatePath("/console/settings");
}

async function editSystemConfig(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  const key = String(formData.get("key") || "");
  const value = String(formData.get("value") || "");
  if (!id || !key) return;
  try {
    // system_control_configs has typed columns per-key (systemMode, aiGenerationEnabled, etc.)
    // Allowlist columns to prevent SQL injection.
    const ALLOWED = new Set([
      "systemMode",
      "aiGenerationEnabled",
      "autonomyEnabled",
      "winnerPromotionEnabled",
      "emergencyStopEnabled",
      "requireHumanApproval",
      "reviewCadence",
    ]);
    if (!ALLOWED.has(key)) return;
    // Cast boolean-like strings appropriately.
    let typedValue: string | boolean = value;
    if (value === "true") typedValue = true;
    else if (value === "false") typedValue = false;
    await panelExec(
      // eslint-disable-next-line @typescript-eslint/quotes
      `UPDATE system_control_configs SET "${key}" = $1 WHERE id = $2`,
      [typedValue as string, id],
    );
  } catch {
    /* swallow */
  }
  revalidatePath("/console/settings");
}

async function revokeEntitlement(formData: FormData) {
  "use server";
  const id = String(formData.get("id") || "");
  if (!id) return;
  try {
    await panelExec(`DELETE FROM tenant_entitlement_grants WHERE id = $1`, [id]);
  } catch {
    /* swallow */
  }
  revalidatePath("/console/settings");
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const { flags, entitlements, configs } = await loadSettingsData();

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/settings"
      title="Settings"
      subtitle={`${flags.length} flag(s) · ${entitlements.length} entitlement(s) · ${configs.length} system config(s)`}
    >
      <SectionCard
        title="Feature Flags"
        subtitle="Toggle features on/off without redeploying. Changes take effect on next request."
      >
        <DataTable
          columns={[
            { key: "key", header: "Key", render: (f) => <span className="font-mono text-white">{f.key}</span> },
            { key: "desc", header: "Description", render: (f) => f.description || "—" },
            {
              key: "enabled",
              header: "Status",
              align: "right",
              render: (f) => (
                <form action={toggleFeatureFlag} className="inline-flex items-center gap-2">
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="enable" value={f.enabled ? "false" : "true"} />
                  <Toggle name="_" checked={f.enabled} />
                  <button type="submit" className="text-[10px] text-fuchsia-300 underline-offset-2 hover:underline">
                    {f.enabled ? "Disable" : "Enable"}
                  </button>
                </form>
              ),
            },
          ]}
          rows={flags}
          rowKey={(f) => f.id}
          emptyTitle="No feature flags"
        />
      </SectionCard>

      <SectionCard
        title="System Configs"
        subtitle="Platform-wide runtime configuration. Changes take effect immediately."
      >
        {configs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-slate-500">
            No system configs to display.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/5">
            <table className="min-w-full divide-y divide-white/5 text-xs">
              <thead>
                <tr className="bg-white/[0.02] text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {configs.map((c) => (
                  <tr key={`${c.id}-${c.key}`} className="transition hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-white">{c.key}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-slate-300">{c.value || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <form action={editSystemConfig} className="inline-flex items-center gap-1.5">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="key" value={c.key} />
                        <input
                          name="value"
                          defaultValue={c.value || ""}
                          className="w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white focus:border-fuchsia-400/40 focus:outline-none focus:ring-1 focus:ring-fuchsia-400/30"
                        />
                        <PrimaryButton />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Tenant Entitlements"
        subtitle="Per-tenant feature grants. Revoke to immediately remove access."
      >
        <DataTable
          columns={[
            { key: "client", header: "Client", render: (e) => e.tenantName || "—" },
            { key: "key", header: "Entitlement", render: (e) => <span className="font-mono text-slate-200">{e.entitlementKey}</span> },
            { key: "status", header: "Status", render: (e) => <StatusPill status={e.status} /> },
            {
              key: "revoke",
              header: "",
              align: "right",
              render: (e) => (
                <form action={revokeEntitlement} className="inline">
                  <input type="hidden" name="id" value={e.id} />
                  <DeleteButton label="Revoke" />
                </form>
              ),
            },
          ]}
          rows={entitlements}
          rowKey={(e) => e.id}
          emptyTitle="No entitlement grants"
        />
      </SectionCard>
    </ConsolePageShell>
  );
}
