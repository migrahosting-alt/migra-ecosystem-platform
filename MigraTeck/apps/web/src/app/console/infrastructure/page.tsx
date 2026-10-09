import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { FocusBanner } from "../components/FocusBanner";
import { nodesWithoutGuestAgent, unverifiedAddresses, alertableNodes } from "../lib/fleet/estate";
import {
  buildInfrastructure,
  GROUPS,
  SOURCE_MATRIX,
  ACTION_MATRIX,
  RECONCILED_AT,
  RECONCILIATION_SOURCE,
  type Channel,
  type InfraNode,
} from "../lib/fleet/infrastructure";
import { loadObservation, uptimeLabel, loadLifecyclePolicy, loadTargetAudit } from "../lib/fleet/observation";

/**
 * DAY 2 — INFRASTRUCTURE, SLICES 1–2.
 *
 * Read-only by design. There is not a single action control on this page, and
 * that is deliberate: the control API now HAS targets (Slice 2 replaced the two
 * empty env registries with one artifact generated from the canonical estate),
 * but it still records success on dispatch without re-observing the target. A
 * button that cannot honestly report its own outcome does not belong here.
 *
 * Before this route existed, "Open Infrastructure" on the Universe page and the
 * Infrastructure summary tile both pointed at /console/ecosystem — the product
 * grid. The estate had no operator surface at all.
 */

const CHANNEL_STYLE: Record<Channel["state"], { dot: string; text: string; label: string }> = {
  available: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Available" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", label: "Degraded" },
  unavailable: { dot: "bg-slate-500", text: "text-slate-400", label: "Not applicable" },
  "not-wired": { dot: "bg-sky-400/70", text: "text-sky-300", label: "Not wired" },
};

const LIFECYCLE_STYLE: Record<string, string> = {
  ACTIVE: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  DRAINING: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  RETIRED: "border-slate-400/20 bg-slate-500/10 text-slate-400",
  PLANNED: "border-sky-400/20 bg-sky-500/10 text-sky-300",
  TEMPLATE: "border-violet-400/20 bg-violet-500/10 text-violet-300",
  TRANSITIONAL: "border-orange-400/25 bg-orange-500/10 text-orange-300",
  ACTIVE_TEST: "border-cyan-400/25 bg-cyan-500/10 text-cyan-300",
};

const PROVENANCE_STYLE: Record<string, string> = {
  discovered: "text-emerald-400/80",
  declared: "text-amber-400/80",
  unverified: "text-rose-400/80",
};

const ChannelPill = ({ channel, label }: { channel: Channel; label: string }) => {
  const s = CHANNEL_STYLE[channel.state];
  return (
    <span className="inline-flex items-center gap-1.5" title={channel.reason ?? channel.mechanism}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[11px] font-medium ${s.text}`}>{s.label}</span>
    </span>
  );
};

const NodeRow = ({ item }: { item: InfraNode }) => {
  const n = item.node;
  const addresses = [n.lanIPv4, n.tailscaleIPv4, n.publicIPv4].filter(Boolean);
  return (
    <Link
      href={`/console/infrastructure/${n.nodeId}`}
      className="block border-b border-white/[0.04] px-4 py-3 transition last:border-b-0 hover:bg-white/[0.03]"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-slate-100">{n.hostname}</span>
        {n.vmid ? <span className="text-[11px] tabular-nums text-slate-500">#{n.vmid}</span> : null}
        <span className="text-[11px] text-slate-500">{n.role}</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
            LIFECYCLE_STYLE[n.lifecycleState] ?? LIFECYCLE_STYLE.RETIRED
          }`}
        >
          {n.lifecycleState}
        </span>
        {/* A node whose administrative state is not ACTIVE must say why on the
            list itself. Two MigraPilot hosts looked equally active for weeks
            because the badge was the only difference and nobody read it. */}
        {n.lifecycleState !== "ACTIVE" && n.lifecycleReason ? (
          <span className="text-[11px] text-orange-300/80">{n.lifecycleReason}</span>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        {addresses.map((a) => (
          <span key={a!.value} className="text-[11px] tabular-nums text-slate-400">
            {a!.value}
            <span className={`ml-1.5 ${PROVENANCE_STYLE[a!.provenance]}`}>{a!.provenance}</span>
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
        {/* Live power state. Unknown is rendered as unknown, never as "stopped". */}
        {(() => {
          const p = item.live?.power;
          if (!p || p.state === null) {
            return (
              <span className="inline-flex items-center gap-1.5" title={p?.reason ?? "not observed"}>
                <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                <span className="text-[11px] text-slate-500">Unknown</span>
              </span>
            );
          }
          const running = p.state === "running";
          const up = uptimeLabel(p.uptimeSeconds);
          return (
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-emerald-400" : "bg-rose-400"}`} />
              <span className={`text-[11px] font-medium ${running ? "text-emerald-300" : "text-rose-300"}`}>
                {p.state}
              </span>
              {up ? <span className="text-[11px] text-slate-500">up {up}</span> : null}
            </span>
          );
        })()}

        {/* Service summary. 0 checked is stated as no coverage, not as health. */}
        {(() => {
          const sv = item.live?.services;
          if (!sv) return null;
          if (sv.checked === 0) {
            return (
              <span className="text-[11px] text-slate-500" title={sv.reason ?? ""}>
                services not checked
              </span>
            );
          }
          const healthy = sv.observations.filter((o) => o.healthy).length;
          const bad = sv.checked - healthy;
          return (
            <span className={`text-[11px] ${bad > 0 ? "text-rose-300" : "text-slate-400"}`}>
              {healthy}/{sv.checked} services healthy
            </span>
          );
        })()}

        <ChannelPill channel={item.observation} label="Observation" />
        <ChannelPill channel={item.control} label="Control" />
      </div>
    </Link>
  );
};

/**
 * Focused arrivals from Overview.
 *
 * Membership is computed from the SAME estate helpers Overview counts with, so
 * "5 VMs cannot be fully inspected" and the five rows this page then shows can
 * never disagree. If this page re-derived the set with its own predicate, the
 * two would drift the moment either changed — the same defect the health
 * resolver was built to remove.
 *
 * Focus narrows the node LIST only. The coverage and scope statements above it
 * keep describing the whole estate, because those sentences are about what the
 * console can and cannot observe overall; scoping them to a subset would make
 * them quietly false.
 */
const FOCUSES: Record<
  string,
  { noun: string; because: string; ids: () => Set<string>; excluded?: (total: number, shown: number) => string }
> = {
  "no-guest-agent": {
    noun: "nodes",
    because: "These VMs have no qemu-guest-agent, so the hypervisor cannot read inside them.",
    ids: () => new Set(nodesWithoutGuestAgent().map((n) => n.nodeId)),
  },
  "unverified-address": {
    noun: "nodes",
    // The Overview control says "Review 7 addresses" and this view counts
    // NODES, because 7 unverified addresses sit on 5 nodes. Reconcile the two
    // numbers out loud rather than leaving the operator to wonder which is
    // wrong — an unexplained mismatch reads as a bug even when both are right.
    because:
      "These nodes carry addresses inherited from documentation or ARP that have never been confirmed from a running guest. One node can carry more than one such address, so the address count is higher than the node count. Treat those addresses as a hypothesis.",
    ids: () => new Set(unverifiedAddresses().map((u) => u.nodeId)),
  },
  active: {
    noun: "nodes",
    because:
      "Lifecycle state ACTIVE or DRAINING — the nodes the estate expects to exist. This is administrative intent, not health.",
    ids: () => new Set(alertableNodes().map((n) => n.nodeId)),
    excluded: (total, shown) =>
      `${total - shown} not shown: templates and retired nodes, which are deliberately excluded from alerting.`,
  },
};

export default async function InfrastructurePage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const [observation, policy, targetAudit] = await Promise.all([
    loadObservation(),
    loadLifecyclePolicy(),
    loadTargetAudit(),
  ]);
  const items = buildInfrastructure(observation, policy);

  const focusKey = (await searchParams).focus;
  const focus = focusKey ? FOCUSES[focusKey] : undefined;
  const focusIds = focus?.ids();
  const focusedItems = focusIds ? items.filter((i) => focusIds.has(i.node.nodeId)) : items;
  const byPlatform = (p: string) => focusedItems.filter((i) => i.node.platform === p);

  const degradedObservation = items.filter((i) => i.observation.state === "degraded");
  const controllable = items.filter((i) => i.control.state === "available");
  const observed = items.filter((i) => i.observation.state === "available");
  const powerKnown = items.filter((i) => i.live?.power.state != null);
  const unreachable = items.filter((i) => (i.live?.services.reason || "").startsWith("could not reach"));

  return (
    <ConsolePageShell
      session={{ email: session.email }}
      activePath="/console/infrastructure"
      title="Infrastructure"
      subtitle="The reconciled estate, what can be observed, and what can be controlled"
    >
      {/* Focused arrival from Overview. Stated up front and always escapable —
          a filtered list the operator cannot tell is filtered is worse than an
          unfiltered one. */}
      {focus ? (
        <FocusBanner
          shown={focusedItems.length}
          total={items.length}
          noun={focus.noun}
          because={focus.because}
          clearHref="/console/infrastructure"
          {...(focus.excluded ? { excluded: focus.excluded(items.length, focusedItems.length) } : {})}
        />
      ) : null}

      {/* ── standing scope statement ─────────────────────────────────── */}
      <section className="rounded-xl border border-sky-400/15 bg-sky-500/[0.04] p-4">
        <h2 className="text-sm font-semibold text-white">Read-only surface</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
          Power state and service health are observed live through the control authority on
          migrapanel-core. The console runs on app-core, which holds no Proxmox credentials and is
          deliberately never given fleet-wide SSH — it asks over a GET-only internal endpoint and
          renders the answer. It never holds the power itself.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          There are <strong className="text-white">no action controls</strong> on this page.{" "}
          {controllable.length === 0
            ? "Start, shutdown and restart stay unexposed: the control API now has targets, but it still records success the moment a command is dispatched, without re-observing the result. A control that cannot report its own outcome does not belong here."
            : `${controllable.length} nodes are controllable.`}
        </p>
        {!observation.available ? (
          <p className="mt-2 text-xs leading-relaxed text-amber-300">
            Live observation unavailable — {observation.reason}. Everything below is administrative
            intent only; nothing on this page is a current measurement.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Power and service coverage are separate questions and are counted separately. Observing a
              guest&apos;s power needs only its vmid, so it covers guests with no usable address —
              {" "}{powerKnown.length} of {observation.coverage.powerTargets ?? observation.coverage.targets}.
              Reaching inside a guest needs a reachable address and an authorised identity —{" "}
              {observation.coverage.servicesObserved} of {observation.coverage.serviceTargets ?? 0} nodes
              with declared units.
              {unreachable.length > 0 ? (
                <>
                  {" "}
                  The control authority&apos;s key is not authorised on{" "}
                  {unreachable.map((u) => u.node.hostname).join(", ")}, so their services are unknown —
                  not healthy.
                </>
              ) : null}
            </p>
            {observation.powerNotice ? (
              <p className="mt-2 text-xs leading-relaxed text-amber-300">
                Power authority degraded — {observation.powerNotice}. The reading is still real, but it
                came from the fallback path.
              </p>
            ) : null}
            <p className="mt-2 text-[10px] text-slate-500">
              Power source {observation.powerSource ?? "unknown"} ·
              Observed {observation.observedAt ? new Date(observation.observedAt).toISOString().replace("T", " ").slice(0, 19) + "Z" : "never"} ·
              targets from a generated artifact, estate sha {String(observation.provenance?.sourceSha256 ?? "").slice(0, 12)}… ·
              estate reconciled {new Date(RECONCILED_AT).toISOString().replace("T", " ").slice(0, 16)}Z ·{" "}
              {RECONCILIATION_SOURCE}
            </p>
          </>
        )}
      </section>

      {/* ── estate counts, each one sourced ──────────────────────────── */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Nodes", value: items.length, note: "reconciled, zero drift" },
          {
            label: "Power observed",
            value: `${powerKnown.length}/${observation.coverage.powerTargets ?? observation.coverage.targets}`,
            note: "guests, by vmid — no address needed",
          },
          {
            label: "Services observed",
            value: `${observation.coverage.servicesObserved}/${observation.coverage.serviceTargets ?? 0}`,
            note: "nodes we can reach inside",
          },
          { label: "Observation gaps", value: degradedObservation.length, note: "partial or no inside view" },
          { label: "Controllable", value: controllable.length, note: "no verified action path yet" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
            <p className="text-lg font-semibold tabular-nums leading-none text-white">{s.value}</p>
            <p className="mt-1 text-[11px] font-medium text-slate-300">{s.label}</p>
            <p className="mt-0.5 text-[10px] leading-tight text-slate-500">{s.note}</p>
          </div>
        ))}
      </section>

      {/* ── the estate ───────────────────────────────────────────────── */}
      {GROUPS.map((g) => {
        const group = byPlatform(g.key);
        if (group.length === 0) return null;
        return (
          <section key={g.key} className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
              <h2 className="text-sm font-semibold text-white">
                {g.title} <span className="ml-1 text-slate-500">{group.length}</span>
              </h2>
              <span className="text-[10px] text-slate-500">{g.blurb}</span>
            </div>
            <div>
              {group.map((item) => (
                <NodeRow key={item.node.nodeId} item={item} />
              ))}
            </div>
          </section>
        );
      })}

      {/* ── hosting target integrity ─────────────────────────────────── */}
      {targetAudit.available && targetAudit.unreconciled > 0 ? (
        <section className="rounded-xl border border-rose-400/25 bg-rose-500/[0.05]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rose-400/20 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Target reconciliation required</h2>
            <span className="text-[10px] text-slate-400">
              {targetAudit.unreconciled} of {targetAudit.total} websites
            </span>
          </div>
          <p className="border-b border-white/[0.05] px-4 py-2 text-[11px] leading-relaxed text-slate-300">
            These websites record a hosting target that does not match an authorized customer workload.
            Server-modifying operations on them are <strong className="text-white">blocked</strong> — the
            control plane refuses the write, so nothing can be applied to the wrong machine. The records
            still need reconciling; the block is a guard, not a fix.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.05] text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Website</th>
                  <th className="px-3 py-2 font-medium">Recorded target</th>
                  <th className="px-3 py-2 font-medium">That target is</th>
                  <th className="px-4 py-2 font-medium">Problem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {targetAudit.rows
                  .filter((r) => r.verdict !== "OK")
                  .map((r) => (
                    <tr key={r.domain} className="align-top hover:bg-white/[0.02]">
                      <td className="px-4 py-2 text-slate-200">{r.domain}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-400">{r.recordedVmid ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400">
                        {r.resolvedGuest ? (
                          <>
                            {r.resolvedGuest}
                            <span className="ml-1.5 text-rose-300">({r.classification})</span>
                          </>
                        ) : (
                          <span className="text-slate-500">a guest that does not exist</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-rose-300/90">
                        {r.verdict === "WRONG_GUEST"
                          ? "Points at core infrastructure, not a customer workload"
                          : r.verdict === "PHANTOM"
                            ? "Points at a guest that is not in the estate"
                            : r.verdict === "TERMINATED"
                              ? "Selected service instance is terminated"
                              : "No hosting target recorded"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* ── source matrix ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Data sources</h2>
          <span className="text-[10px] text-slate-500">
            every source behind this page, and whether it can actually be used
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.05] text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2 font-medium">Concern</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Plane</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {SOURCE_MATRIX.map((r) => (
                <tr key={r.concern} className="align-top hover:bg-white/[0.02]">
                  <td className="px-4 py-2 font-medium text-slate-200">{r.concern}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{r.source}</td>
                  <td className="px-3 py-2 text-[10px] tracking-wider text-slate-500">{r.plane}</td>
                  <td
                    className={`px-3 py-2 whitespace-nowrap ${
                      r.status === "in use"
                        ? "text-emerald-300"
                        : r.status === "verified, not wired"
                          ? "text-sky-300"
                          : r.status === "exists but unusable"
                            ? "text-amber-300"
                            : "text-rose-300"
                    }`}
                  >
                    {r.status}
                  </td>
                  <td className="px-4 py-2 leading-relaxed text-slate-400">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── action matrix ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Operator action contract</h2>
          <span className="text-[10px] text-slate-500">defined before implementation · none wired</span>
        </div>
        <p className="border-b border-white/[0.05] px-4 py-2 text-[11px] leading-relaxed text-slate-500">
          These are specifications, not controls. Each action stays off the page until it can report its
          own outcome honestly: requested → executing → verifying → succeeded or failed. The existing
          endpoint returns <span className="font-mono text-slate-400">status: &quot;sent&quot;</span> the
          moment the command returns, and separately records{" "}
          <span className="font-mono text-slate-400">result: &quot;success&quot;</span> — so a restart that
          leaves a service dead is currently filed as a success.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.05] text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Backend</th>
                <th className="px-3 py-2 font-medium">Guards</th>
                <th className="px-4 py-2 font-medium">Blocking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {ACTION_MATRIX.map((r) => (
                <tr key={r.action} className="align-top hover:bg-white/[0.02]">
                  <td className="px-4 py-2 font-medium text-slate-200">{r.action}</td>
                  <td className="px-3 py-2 text-slate-400">{r.scope}</td>
                  <td className="px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400">
                    {r.backend}
                  </td>
                  <td className="px-3 py-2 leading-relaxed text-slate-400">{r.guards}</td>
                  <td className="px-4 py-2 leading-relaxed text-amber-300/80">{r.blocker}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </ConsolePageShell>
  );
}
