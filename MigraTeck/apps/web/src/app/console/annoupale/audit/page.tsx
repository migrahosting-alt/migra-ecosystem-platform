import { redirect } from "next/navigation";

import { getSession } from "../../lib/auth";
import { AnnoupaleShell } from "../../components/annoupale/AnnoupaleShell";
import { SectionCard } from "../../components/SectionCard";
import { ANNOUPALE_BASE } from "../../lib/annoupale";
import {
  LivePill,
  PanelUnavailable,
  StatCard,
  fmtDateTime,
} from "../../components/annoupale/annoupale-ui";
import { adminReasonLabel } from "../../lib/annoupale/admin-fetch";
import { loadAuditLog } from "../../lib/annoupale/audit";
import { AuditLogView } from "../../components/annoupale/AuditLogView";

export const dynamic = "force-dynamic";

export default async function AnnoupaleAuditPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const result = await loadAuditLog({ windowHours: 24 });

  return (
    <AnnoupaleShell
      session={session}
      title="Audit Log"
      subtitle="Staff actions across compliance, moderation, and appeals. Hashed IPs and raw metadata are never shown."
      actions={<LivePill connected={result.connected} label={result.connected ? "Live" : "Unavailable"} />}
    >
      {result.connected ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="Events (24h)"
              accent="text-sky-300"
              value={`${result.windowCount}${result.windowCapped ? "+" : ""}`}
              hint={result.windowCapped ? "Capped — refine in AnnouPale" : "Last 24 hours"}
            />
            <StatCard
              label="Most recent"
              accent="text-slate-200"
              value={result.items[0] ? fmtDateTime(result.items[0].createdAt).slice(11) : "—"}
              hint={result.items[0] ? fmtDateTime(result.items[0].createdAt).slice(0, 10) : undefined}
            />
            <StatCard label="Window" accent="text-slate-200" value="24h" hint="Rolling" />
          </div>

          <SectionCard title="Recent events" subtitle="Filter the loaded 24h window by action, actor, or target. Click a row for safe detail.">
            <AuditLogView items={result.items} windowCapped={result.windowCapped} />
          </SectionCard>
        </>
      ) : (
        <SectionCard title="Audit log">
          <PanelUnavailable
            message={adminReasonLabel(result.reason)}
            fallbackHref={`${ANNOUPALE_BASE}/admin`}
            fallbackLabel="Open AnnouPale admin"
          />
        </SectionCard>
      )}
    </AnnoupaleShell>
  );
}
