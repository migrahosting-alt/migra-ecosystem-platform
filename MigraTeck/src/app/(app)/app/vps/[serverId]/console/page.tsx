import { notFound } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getVpsDashboardPayload } from "@/lib/vps/data";
import { VpsConsoleLauncher } from "@/components/app/vps-console-launcher";
import { VpsDetailGrid, VpsSectionCard } from "@/components/app/vps-ui";

export default async function VpsConsolePage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    notFound();
  }

  const payload = await getVpsDashboardPayload(serverId, membership);

  if (!payload) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <VpsSectionCard title="Console session" description="Launch a browser console session and validate provider access for this server.">
        <div className="min-h-[16rem] rounded-2xl border border-slate-800 bg-[#09111d] p-6 text-sm text-slate-300 shadow-inner">
          <p className="font-mono">Browser console sessions open in a separate tab using the current provider binding.</p>
          <p className="mt-3 font-mono text-slate-400">Use this page to verify session launch, expiry handling, and operator access posture before testing rescue or rebuild flows.</p>
        </div>
        <div className="mt-4">
          <VpsConsoleLauncher serverId={serverId} disabled={!payload.actions.canOpenConsole || !payload.features.console} />
        </div>
      </VpsSectionCard>

      <VpsSectionCard title="Console access posture" description="Live access state for launch permissions, rescue mode, and console readiness.">
        <VpsDetailGrid
          items={[
            { label: "Launch allowed", value: payload.actions.canOpenConsole && payload.features.console ? "Yes" : "No" },
            { label: "Provider", value: payload.server.providerSlug },
            { label: "Server power", value: payload.server.powerState },
            { label: "Server status", value: payload.server.status },
            { label: "Rescue mode", value: payload.server.rescueEnabled ? "Enabled" : "Disabled" },
            { label: "Pending jobs", value: String(payload.sync.pendingActionCount) },
            { label: "SSH fallback", value: payload.server.sshEndpoint },
            { label: "Last sync", value: payload.sync.lastSyncedAt ? new Date(payload.sync.lastSyncedAt).toLocaleString() : "Never" },
          ]}
        />
        {!payload.actions.canOpenConsole || !payload.features.console ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Console launch is currently unavailable for your role or this provider binding. The surrounding diagnostics remain valid for testing access posture.
          </div>
        ) : null}
      </VpsSectionCard>
    </div>
  );
}
