import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../lib/auth";
import { loadEcosystem, serviceIdsFor } from "../lib/ecosystem";
import { buildProductTopology, sharedHosts } from "../lib/fleet/product-topology";
import { loadServiceHealth } from "../lib/health";
import { current } from "../lib/fleet/health-contract";
import { HealthPill, STATE_LABEL, provenanceOf } from "../components/HealthState";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { StatsRow } from "../components/StatsRow";
import { ProductLogo } from "../components/ProductLogo";

export const dynamic = "force-dynamic";

/*
 * REMOVED: two local status maps and a ROUTE_FOR table.
 *
 * The status maps were a THIRD vocabulary for the same union — this page
 * rendered `health.state` raw, so six products read "Operational" here while
 * the Overview grid called the identical state "Healthy". One backend state,
 * one UI vocabulary: components/HealthState.tsx now owns the word, the dot and
 * the badge colour, and there is nothing left here to drift.
 *
 * ROUTE_FOR was a second navigation authority competing with the product
 * registry, and they disagreed for 4 of 10 products. The worst case was not a
 * broken link but a WRONG one: MigraPanel's "Open" opened the internal client
 * list from Overview and the customer-facing login portal, in a new tab, from
 * here. Same product, same label, different destination. The registry owns
 * navigation now, so that is no longer expressible.
 */

export default async function EcosystemPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");
  // Product health is derived from the estate's service observations, so this
  // page takes its own probe pass and passes it in. The dependency is explicit
  // rather than hidden inside loadEcosystem(), which is what keeps the Overview
  // grid and this page from becoming two independent opinions again.
  const services = await loadServiceHealth();
  const tiles = await loadEcosystem(services);

  // The four-level read model: PRODUCT / SERVICE INSTANCE / DEPLOYMENT / HOST.
  // Composed from the SAME observation pass the tiles render, and from the same
  // dependency declaration the health resolver uses — no second authority.
  const topology = new Map(
    tiles.map((t) => [t.id, buildProductTopology(t.id, serviceIdsFor(t.id), services)]),
  );
  const shared = sharedHosts([...topology.values()]);

  // Expiry is applied here, at render time, so a verdict cannot age into a lie
  // between observation and display.
  const states = tiles.map((t) => current(t.health).state);
  const operational = states.filter((s) => s === "operational").length;
  const degraded = states.filter((s) => s === "degraded").length;
  const down = states.filter((s) => s === "down").length;
  const unverified = states.filter((s) => s === "unknown").length;
  const measured = tiles.filter((t) => t.activity !== null).length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/ecosystem"
      title="Ecosystem"
      /* Was "N products under unified control". Nothing on this page controls
         anything — every tile is a link. Claiming control the surface does not
         have is the same defect as a button that reports success without
         acting, so the subtitle now says what the page actually does. */
      subtitle={`${tiles.length} products · health derived from live service observation · no control surface yet`}
    >
      <StatsRow
        stats={[
          // EVERY label here comes from the canonical map. The summary used to
          // say "Unverified" while the cards beneath said "Unknown", and
          // "Degraded or down" introduced a fourth word for a state that is
          // currently never produced. A summary that renames the states it is
          // summarising is the same vocabulary split, one level up.
          { label: "Total products", value: tiles.length },
          { label: STATE_LABEL.operational, value: operational, accent: operational > 0 ? "ok" : undefined },
          {
            label: STATE_LABEL.degraded,
            value: degraded,
            // Down is a real canonical state, just not one anything produces
            // today. It is named only when it actually occurs, rather than
            // padding the label with a word the operator never sees.
            ...(down > 0 ? { sub: `+${down} ${STATE_LABEL.down.toLowerCase()}` } : {}),
            accent: degraded + down > 0 ? "warn" : undefined,
          },
          {
            label: STATE_LABEL.unknown,
            value: unverified,
            sub: "no current observation",
            accent: unverified > 0 ? "warn" : undefined,
          },
        ]}
      />

      {/* Informational strip, not a fifth summary card. As a card it wrapped
          onto its own row and sat alone beside a large empty area; it is a
          coverage note, not a headline figure. */}
      <p className="-mt-1 text-[11px] text-slate-500">
        Activity measured for <span className="text-slate-300">{measured}</span> of {tiles.length}{" "}
        products — the rest have no defined metric.
        {" · "}
        Health derived from {services.length} internal service probes.
        {" · "}
        Only the console reports its own deployment; no other product reports one yet.
      </p>

      <SectionCard
        title="All Products"
        subtitle="Click any product to open its management module"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => {
            // The registry owns navigation. Same product, same label, same
            // destination — wherever in the console it is rendered.
            const href = t.primaryAction.href;
            const isExternal = href.startsWith("http");
            const health = current(t.health);
            return (
              <Link
                key={t.id}
                href={href}
                target={isExternal ? "_blank" : undefined}
                className="group flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.02] p-5 transition hover:border-white/25 hover:bg-white/[0.04]"
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <ProductLogo src={t.logoSrc} alt={t.logoAlt} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {t.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {t.subtitle}
                    </p>
                  </div>
                </div>
                {/* STATE — the second thing read, right under identity. */}
                <div className="mt-3">
                  <HealthPill health={t.health} />
                </div>
                {/* A state is never shown without its provenance. It used to
                    share one flex row with the pill and the CTA and truncated
                    to "derived from MigraTeck Co…" — present, correct, and
                    unreadable. It gets its own line. */}
                <p
                  className="mt-2 text-[10px] leading-tight text-slate-500"
                  title={provenanceOf(health)}
                >
                  {provenanceOf(health)}
                </p>                {/* Activity — rendered ONLY when a denominator is defined.
                    Showing "—  activity not measured" on every unmeasured tile
                    added two lines of nothing to most cards. The fact is not
                    lost: the strip above the grid states how many products have
                    a defined metric, once, where it belongs. A zero denominator
                    now arrives here as null rather than 0%, so a product with
                    no job runs no longer claims 0% succeeded. */}
                {t.activity ? (
                  <div className="mt-3">
                    <p className="font-mono text-sm text-slate-200">{t.activity.pct.toFixed(1)}%</p>
                    <p className="mt-0.5 text-[10px] leading-tight text-slate-500">
                      {t.activity.describes}
                    </p>
                  </div>
                ) : null}
                {(() => {
                  const topo = topology.get(t.id);
                  if (!topo) return null;
                  const hostLabel =
                    topo.hosts.length > 0
                      ? topo.hosts
                          .map((h) => `${h.nodeId}${h.vmid ? ` (${h.platform.toUpperCase()} ${h.vmid})` : ""}`)
                          .join(", ")
                      : null;
                  // ONE compact line. Every card used to repeat
                  // "this product does not report a deployment to the console"
                  // and a separate host-reason line — truthful, but nine
                  // identical sentences dominated the first glance. The absence
                  // of a deployment source is a fact about the ESTATE, not about
                  // each product, so it is stated once on the page instead. The
                  // full reason stays available on hover.
                  const summary = [
                    topo.serviceInstances.length === 0
                      ? "no service instance declared"
                      : `${topo.serviceInstances.length} service${topo.serviceInstances.length === 1 ? "" : "s"}`,
                    topo.serviceInstances.length === 0
                      ? null
                      : hostLabel ?? "host unresolved",
                    topo.deployment ? `release ${topo.deployment.release}` : null,
                  ].filter(Boolean).join(" · ");
                  const detail = [
                    topo.serviceReason,
                    !hostLabel ? topo.serviceInstances[0]?.hostReason : null,
                    topo.deploymentReason,
                  ].filter(Boolean).join(" — ");
                  return (
                    <p
                      className="mt-2 truncate border-t border-white/[0.06] pt-2 text-[10px] leading-tight text-slate-500"
                      title={detail || summary}
                    >
                      {summary}
                    </p>
                  );
                })()}
                {/* ACTION last: the operator decides to act after reading
                    state, activity and placement — not before. mt-auto keeps it
                    pinned to the bottom so cards of differing content still
                    line their actions up. */}
                <div className="mt-auto flex justify-end pt-3">
                  <span className="text-[11px] font-medium text-fuchsia-300 transition group-hover:text-fuchsia-200">
                    {t.primaryAction.label} →
                  </span>
                </div>

                {/* Status + CTA */}

                {/* Four-level read model, compactly: what is actually probed,
                    and where it runs. A tile used to be all four concepts at
                    once and could not say either. Unknowns state their reason
                    rather than being omitted. */}
              </Link>
            );
          })}
        </div>
      </SectionCard>

      {/* HOST / INFRASTRUCTURE level.
          The flat grid could not express correlation: three products share one
          host, so one host outage darkens three tiles and the page offered no
          way to see why. Derived from the estate registry by resolving each
          service endpoint's address — not from a product-to-host table. */}
      {shared.length > 0 ? (
        <SectionCard
          title="Shared hosts"
          subtitle="One host, several products — a single host failure takes all of them"
        >
          <ul className="divide-y divide-white/[0.05]">
            {shared.map(({ host, productIds }) => (
              <li key={host.nodeId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="text-sm font-medium text-slate-200">{host.nodeId}</span>
                <span className="text-[11px] text-slate-500">
                  {host.platform}
                  {host.vmid ? ` ${host.vmid}` : ""} · {host.lifecycleState} · {host.environment}
                </span>
                <span className="text-[11px] text-slate-400">
                  carries{" "}
                  {productIds
                    .map((id) => tiles.find((t) => t.id === id)?.name ?? id)
                    .join(", ")}
                </span>
                <span className="text-[10px] text-slate-600">
                  matched on {host.matchedAddress} ({host.addressProvenance})
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </ConsolePageShell>
  );
}
