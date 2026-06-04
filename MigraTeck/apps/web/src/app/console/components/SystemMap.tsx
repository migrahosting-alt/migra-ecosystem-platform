/**
 * System Orchestration Map — a static SVG diagram that shows how the products
 * relate. Node counts come from real data (e.g. "1,248 Active" for Clients) so
 * the map reflects the live state even though the connections themselves are
 * a topology, not a live data flow.
 *
 * Layout (viewBox 800×520):
 *  - Top row (1):     Clients (centered, y=70)
 *  - Mid-left  (2):   Domains (y=190), Email (y=320)
 *  - Center (1):      MigraPanel Core (cx=400, cy=260, r=72) — official logo
 *  - Mid-right (2):   Hosting (y=190), Voice (y=320)
 *  - Bottom row (4):  Intake / Automation / Marketing / Billing — evenly spaced
 *                      at x = 120, 300, 500, 680 (180 px apart, no overlap)
 */

import Image from "next/image";

export type SystemMapNodes = {
  clients: { active: number };
  domains: { total: number };
  hosting: { active: number };
  email: { mailboxes: number };
  voice: { lines: number };
  intake: { forms: number };
  automation: { runs: number };
  marketing: { campaigns: number };
  billing: { mrrUsd: number };
};

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Center of map (matches viewBox)
const CX = 400;
const CY = 260;

// Card dimensions
const CARD_W = 130;
const CARD_H = 60;

// Bottom row positions (180 px apart — no overlap with card width 130)
const BOTTOM_Y = 460;

export const SystemMap = ({ nodes }: { nodes: SystemMapNodes }) => {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">System Orchestration Map</h2>
      </div>

      <div className="relative aspect-[16/10] w-full">
        <svg
          viewBox="0 0 800 520"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="node-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
            </linearGradient>
          </defs>

          {/* connection lines */}
          <g stroke="rgba(217,70,239,0.35)" strokeWidth="1.5" fill="none" strokeDasharray="3 4">
            <path d={`M${CX},100 L${CX},${CY - 72}`} />
            <path d={`M150,200 L${CX - 72},${CY - 20}`} />
            <path d={`M650,200 L${CX + 72},${CY - 20}`} />
            <path d={`M150,330 L${CX - 72},${CY + 20}`} />
            <path d={`M650,330 L${CX + 72},${CY + 20}`} />
            <path d={`M120,${BOTTOM_Y} L${CX - 50},${CY + 60}`} />
            <path d={`M300,${BOTTOM_Y} L${CX - 18},${CY + 70}`} />
            <path d={`M500,${BOTTOM_Y} L${CX + 18},${CY + 70}`} />
            <path d={`M680,${BOTTOM_Y} L${CX + 50},${CY + 60}`} />
          </g>

          {/* outer nodes */}
          <SatNode x={CX} y={70} icon="🧑‍🤝‍🧑" label="Clients" sub={`${fmt(nodes.clients.active)} Active`} />
          <SatNode x={150} y={190} icon="🌐" label="Domains" sub={`${fmt(nodes.domains.total)} Total`} />
          <SatNode x={650} y={190} icon="🖥️" label="Hosting" sub={`${fmt(nodes.hosting.active)} Active`} />
          <SatNode x={150} y={320} icon="✉️" label="Email" sub={`${fmt(nodes.email.mailboxes)} Mailboxes`} />
          <SatNode x={650} y={320} icon="📞" label="Voice" sub={`${fmt(nodes.voice.lines)} Lines`} />
          {/* Bottom row — 4 cards, 180 px apart, no overlap */}
          <SatNode x={120} y={BOTTOM_Y} icon="📝" label="Intake" sub={`${fmt(nodes.intake.forms)} Forms`} />
          <SatNode x={300} y={BOTTOM_Y} icon="⚙️" label="Automation" sub={`${fmt(nodes.automation.runs)} Runs`} />
          <SatNode x={500} y={BOTTOM_Y} icon="📣" label="Marketing" sub={`${fmt(nodes.marketing.campaigns)} Campaigns`} />
          <SatNode x={680} y={BOTTOM_Y} icon="💳" label="Billing" sub={`${fmtUsd(nodes.billing.mrrUsd)} MRR`} />
        </svg>

        {/* Official MigraPanel logo overlay — centered absolutely over the SVG */}
        <div
          className="pointer-events-none absolute flex flex-col items-center"
          style={{
            left: `${(CX / 800) * 100}%`,
            top: `${(CY / 520) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <Image
            src="/brands/products/migrapanel.png"
            alt="MigraPanel"
            width={144}
            height={144}
            className="h-24 w-24 drop-shadow-[0_0_24px_rgba(217,70,239,0.45)] sm:h-28 sm:w-28 lg:h-32 lg:w-32"
            priority
          />
          <p className="mt-1 text-[11px] font-semibold text-white">MigraPanel</p>
          <p className="text-[10px] text-slate-400">Core</p>
        </div>
      </div>
    </section>
  );
};

const SatNode = ({
  x,
  y,
  icon,
  label,
  sub,
}: {
  x: number;
  y: number;
  icon: string;
  label: string;
  sub: string;
}) => (
  <g transform={`translate(${x - CARD_W / 2} ${y - CARD_H / 2})`}>
    <rect
      width={CARD_W}
      height={CARD_H}
      rx="14"
      fill="url(#node-grad)"
      stroke="rgba(255,255,255,0.12)"
      strokeWidth="1"
    />
    <text x="14" y="26" fontSize="18">
      {icon}
    </text>
    <text x="42" y="26" className="fill-white font-semibold" fontSize="11">
      {label}
    </text>
    <text x="14" y="46" className="fill-white/60" fontSize="10">
      {sub}
    </text>
  </g>
);
