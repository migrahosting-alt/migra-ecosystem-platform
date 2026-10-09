import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { buildInfrastructure, ACTION_MATRIX, RECONCILED_AT, type Channel } from "../../lib/fleet/infrastructure";
import { loadObservation, uptimeLabel, loadLifecyclePolicy } from "../../lib/fleet/observation";
import { LifecycleControls } from "../../components/LifecycleControls";

/**
 * Node detail — the operator workspace, Slice 1 shape.
 *
 * This is the layout an operator will actually work in, populated with
 * everything we can currently state truthfully. The runtime block is present and
 * explicitly unknown rather than absent, because the shape of the page is part
 * of what is being reviewed: when the observation channel is wired, values land
 * in these slots and nothing else moves.
 */

const CHANNEL_STYLE: Record<Channel["state"], { dot: string; text: string; label: string }> = {
  available: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Available" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", label: "Degraded" },
  unavailable: { dot: "bg-slate-500", text: "text-slate-400", label: "Not applicable" },
  "not-wired": { dot: "bg-sky-400/70", text: "text-sky-300", label: "Not wired" },
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-baseline gap-x-3 border-b border-white/[0.04] px-4 py-2 last:border-b-0">
    <span className="w-40 shrink-0 text-[11px] text-slate-500">{label}</span>
    <span className="min-w-0 flex-1 text-xs text-slate-200">{children}</span>
  </div>
);

const Unknown = ({ reason }: { reason: string }) => (
  <span>
    <span className="text-slate-400">—</span>
    <span className="ml-2 text-[11px] text-slate-500">{reason}</span>
  </span>
);

export default async function NodeDetailPage({ params }: { params: Promise<{ nodeId: string }> }) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const { nodeId } = await params;
  const [observation, policy] = await Promise.all([loadObservation(), loadLifecyclePolicy()]);
  const item = buildInfrastructure(observation, policy).find((i) => i.node.nodeId === nodeId);
  if (!item) notFound();

  const n = item.node;
  const addresses = [
    { label: "LAN", a: n.lanIPv4 },
    { label: "Tailscale", a: n.tailscaleIPv4 },
    { label: "Public", a: n.publicIPv4 },
  ].filter((x) => x.a);

  const obs = CHANNEL_STYLE[item.observation.state];
  const ctl = CHANNEL_STYLE[item.control.state];

  // Actions relevant to this node's platform, still specifications only.
  const relevant = ACTION_MATRIX.filter((a) =>
    n.platform === "hypervisor" ? false : !a.action.startsWith("Destroy"),
  );

  return (
    <ConsolePageShell
      session={{ email: session.email }}
      activePath="/console/infrastructure"
      title={n.hostname}
      subtitle={`${n.role} · ${n.platform}${n.vmid ? ` · guest ${n.vmid}` : ""} · ${n.environment}`}
    >
      <Link
        href="/console/infrastructure"
        className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 transition hover:text-slate-200"
      >
        <span aria-hidden>←</span> All infrastructure
      </Link>

      {/* ── control eligibility: always stated, never a hidden rule ────── */}
      {(() => {
        const p = item.node.vmid != null ? policy.byVmid.get(item.node.vmid) : undefined;
        const tier = p?.eligibility ?? "NONE";
        const TIER_LABEL: Record<string, string> = {
          NONE: "Not eligible",
          CANARY: "Canary / test",
          LOW_RISK: "Low-risk control",
          PRODUCTION: "Production",
          CRITICAL: "Critical",
        };
        const canAct = !!p && p.actions.length > 0;

        return (
          <section
            className={`rounded-xl border ${
              canAct ? "border-emerald-400/20 bg-emerald-500/[0.04]" : "border-white/[0.07] bg-white/[0.02]"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
              <h2 className="text-sm font-semibold text-white">
                Control{" "}
                <span className={canAct ? "text-emerald-300" : "text-slate-400"}>
                  {canAct ? "Available" : "Unavailable"}
                </span>
              </h2>
              <span className="text-[10px] text-slate-500">
                Tier: {TIER_LABEL[tier] ?? tier}
                {p?.actions.length ? ` · allowed: ${p.actions.join(", ")}` : ""}
                {canAct && (p?.approvalRequired || p?.stepUpRequired)
                  ? ` · requires ${[p?.approvalRequired ? "approval" : null, p?.stepUpRequired ? "WebAuthn" : null].filter(Boolean).join(" + ")}`
                  : ""}
              </span>
            </div>
            {!canAct ? (
              <p className="px-4 py-3 text-xs leading-relaxed text-slate-300">
                {p?.settling ? (
                  <>
                    <span className="text-sky-200">Lifecycle operation settling…</span> A{" "}
                    {p.settlingAs ?? "power"} operation is still completing on the hypervisor. Controls
                    return automatically once it clears.
                  </>
                ) : (
                  <>
                    <span className="text-slate-400">Reason: </span>
                    {p?.blockedReason ?? p?.policyReason ?? "This guest has not been promoted for console lifecycle control."}
                  </>
                )}
              </p>
            ) : null}
            {canAct ? (
              <LifecycleControls
                vmid={item.node.vmid as number}
                nodeName={item.node.hostname}
                currentStatus={item.live?.power.state ?? null}
                observedAt={item.live?.power.observedAt ?? null}
                services={(item.live?.services.observations ?? []).map((o) => o.unit)}
                allowedActions={p!.actions as Array<"start" | "shutdown" | "restart">}
              />
            ) : null}
          </section>
        );
      })()}

      {/* ── runtime state, observed through the control authority ─────── */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Runtime state</h2>
          <span className="text-[10px] text-slate-500">
            {item.live?.power.observedAt
              ? `observed ${new Date(item.live.power.observedAt).toISOString().replace("T", " ").slice(0, 19)}Z · ${item.live.power.source}`
              : "not observed"}
          </span>
        </div>

        <Row label="Power state">
          {item.live?.power.state ? (
            <span className={item.live.power.state === "running" ? "text-emerald-300" : "text-rose-300"}>
              {item.live.power.state}
            </span>
          ) : (
            <Unknown reason={item.live?.power.reason ?? observation.reason ?? "not observed"} />
          )}
        </Row>

        <Row label="Uptime">
          {uptimeLabel(item.live?.power.uptimeSeconds ?? null) ?? (
            <Unknown reason="not reported for this guest" />
          )}
        </Row>

        {/* MEMORY — the rule this page exists to enforce.
            For a guest with no working agent the hypervisor reports memory it has
            handed over, including cache the guest counts as reclaimable. Measured
            here: app-core 91% at the host vs ~35% in the guest. So guest memory is
            UNKNOWN, and host allocation is shown separately, labelled as host
            accounting, never as a utilisation percentage. */}
        <Row label="Memory (guest)">
          {item.live?.memory.guestMetricsAvailable ? (
            <Unknown reason="guest agent responds, but in-guest metrics are not collected yet" />
          ) : (
            <Unknown reason="guest metrics unavailable — no working qemu-guest-agent on this node" />
          )}
        </Row>
        {item.live?.memory.hostAllocationMB != null ? (
          <Row label="Host allocation">
            <span className="tabular-nums text-slate-300">
              {(item.live.memory.hostAllocationMB / 1024).toFixed(1)} GB
              {item.live.memory.hostMaxMB
                ? ` of ${(item.live.memory.hostMaxMB / 1024).toFixed(1)} GB assigned`
                : ""}
            </span>
            <span className="ml-2 text-[11px] text-amber-300/80">
              hypervisor accounting — not equivalent to guest memory pressure
            </span>
          </Row>
        ) : null}

        <Row label="Filesystem">
          <Unknown reason="Proxmox does not report disk usage for QEMU guests; must come from inside the guest" />
        </Row>
      </section>

      {/* ── services ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Role-critical services</h2>
          <span className="text-[10px] text-slate-500">
            {item.live?.services.observedAt
              ? `observed ${new Date(item.live.services.observedAt).toISOString().replace("T", " ").slice(0, 19)}Z · systemctl show`
              : "not observed"}
          </span>
        </div>
        {!item.live || item.live.services.observations.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-400">
            <span className="text-slate-400">—</span>
            <span className="ml-2 text-[11px] text-slate-500">
              {item.live?.services.reason ?? "no role-critical units are declared for this node"}
            </span>
          </p>
        ) : (
          <>
            {item.live.services.checked === 0 ? (
              <p className="border-b border-white/[0.05] px-4 py-2 text-[11px] leading-relaxed text-amber-300/90">
                {item.live.services.reason} — these units are UNKNOWN, not healthy. Nothing was
                measured, so nothing can be concluded.
              </p>
            ) : null}
            {item.live.services.observations.map((o) => (
              <div
                key={o.unit}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-white/[0.04] px-4 py-2 last:border-b-0"
              >
                <span className="w-64 shrink-0 font-mono text-[11px] text-slate-300">{o.unit}</span>
                {o.healthy === null ? (
                  <span className="text-[11px] text-slate-500">unknown</span>
                ) : (
                  <span
                    className={`text-[11px] font-medium ${o.healthy ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {o.activeState}
                    {o.subState ? ` · ${o.subState}` : ""}
                  </span>
                )}
                {o.restarts != null && o.restarts > 0 ? (
                  <span className="text-[11px] text-amber-300/80">{o.restarts} restarts</span>
                ) : null}
                {o.since ? <span className="text-[11px] text-slate-500">since {o.since}</span> : null}
              </div>
            ))}
          </>
        )}
      </section>

      {/* ── identity ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div className="border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Identity</h2>
        </div>
        <Row label="Node ID">
          <span className="font-mono text-[11px]">{n.nodeId}</span>
        </Row>
        <Row label="Platform">
          {n.platform}
          {n.vmid ? <span className="ml-2 text-slate-500">guest {n.vmid}</span> : null}
        </Row>
        <Row label="Role">{n.role}</Row>
        <Row label="Environment">{n.environment}</Row>
        <Row label="Lifecycle intent">
          {n.lifecycleState}
          {n.lifecycleReason ? <span className="ml-2 text-slate-500">{n.lifecycleReason}</span> : null}
          <span className="ml-2 text-[11px] text-slate-500">
            administrative intent, not health — a RETIRED node may still respond
          </span>
        </Row>
        {addresses.map(({ label, a }) => (
          <Row key={label} label={`${label} address`}>
            <span className="font-mono text-[11px] tabular-nums">{a!.value}</span>
            <span
              className={`ml-2 text-[11px] ${
                a!.provenance === "discovered"
                  ? "text-emerald-400/80"
                  : a!.provenance === "declared"
                    ? "text-amber-400/80"
                    : "text-rose-400/80"
              }`}
            >
              {a!.provenance}
              {a!.provenance === "unverified" ? " — hypothesis, not confirmed from a running guest" : ""}
            </span>
          </Row>
        ))}
        {n.notes ? <Row label="Notes">{n.notes}</Row> : null}
      </section>

      {/* ── channels ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${obs.dot}`} />
            <h2 className="text-sm font-semibold text-white">Observation</h2>
            <span className={`text-[11px] font-medium ${obs.text}`}>{obs.label}</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Mechanism</p>
          <p className="text-xs text-slate-300">{item.observation.mechanism}</p>
          {item.observation.reason ? (
            <>
              <p className="mt-2 text-[11px] text-slate-500">Why</p>
              <p className="text-xs leading-relaxed text-slate-300">{item.observation.reason}</p>
            </>
          ) : null}
          <p className="mt-2 text-[10px] text-slate-500">
            capability last confirmed{" "}
            {item.observation.verifiedAt
              ? new Date(item.observation.verifiedAt).toISOString().replace("T", " ").slice(0, 16) + "Z"
              : "never"}
          </p>
        </section>

        <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${ctl.dot}`} />
            <h2 className="text-sm font-semibold text-white">Control</h2>
            <span className={`text-[11px] font-medium ${ctl.text}`}>{ctl.label}</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Path</p>
          <p className="text-xs leading-relaxed text-slate-300">{item.control.mechanism}</p>
          {item.control.reason ? (
            <>
              <p className="mt-2 text-[11px] text-slate-500">Why nothing is exposed</p>
              <p className="text-xs leading-relaxed text-slate-300">{item.control.reason}</p>
            </>
          ) : null}
        </section>
      </div>

      {/* ── metrics that would lie ───────────────────────────────────── */}
      {item.untrustworthyMetrics.length > 0 ? (
        <section className="rounded-xl border border-amber-400/15 bg-amber-500/[0.04] p-4">
          <h2 className="text-sm font-semibold text-white">Metrics that must not be shown for this node</h2>
          <p className="mt-1 text-[11px] text-slate-400">
            Recorded so a future panel cannot quietly reintroduce them.
          </p>
          <ul className="mt-2 space-y-1.5">
            {item.untrustworthyMetrics.map((m) => (
              <li key={m.metric} className="text-xs text-slate-300">
                <span className="font-medium text-amber-200">{m.metric}</span>
                <span className="text-slate-400"> — {m.why}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── planned actions, as specifications ───────────────────────── */}
      {relevant.length > 0 ? (
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Planned operator actions</h2>
            <span className="text-[10px] text-slate-500">specifications · deliberately not clickable</span>
          </div>
          <p className="border-b border-white/[0.05] px-4 py-2 text-[11px] leading-relaxed text-slate-500">
            Listed as text rather than disabled buttons. A greyed-out control still advertises a
            capability, and the estate has enough of those already.
          </p>
          {relevant.map((a) => (
            <div key={a.action} className="border-b border-white/[0.04] px-4 py-2.5 last:border-b-0">
              <p className="text-xs font-medium text-slate-200">{a.action}</p>
              <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-slate-500">{a.backend}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                <span className="text-slate-500">Guards:</span> {a.guards}
              </p>
              <p className="text-[11px] text-amber-300/80">
                <span className="text-slate-500">Blocking:</span> {a.blocker}
              </p>
            </div>
          ))}
        </section>
      ) : (
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <h2 className="text-sm font-semibold text-white">Planned operator actions</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            None. Acting on the hypervisor affects every guest at once, so it is deliberately excluded
            from operator control rather than merely unimplemented.
          </p>
        </section>
      )}

      <p className="text-[10px] text-slate-600">
        Estate reconciled {new Date(RECONCILED_AT).toISOString().replace("T", " ").slice(0, 16)}Z.
        Runtime values are read through the control authority; anything it could not measure is shown
        as unknown with the reason, never as a default.
      </p>
    </ConsolePageShell>
  );
}
