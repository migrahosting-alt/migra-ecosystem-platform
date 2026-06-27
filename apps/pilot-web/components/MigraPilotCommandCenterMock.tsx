"use client";

const logo = "/assets/MigraPilot_official_logo.png";

const navGroups = [
  {
    title: "Workspace",
    items: ["Conversations", "Agents", "Playbooks", "Runs"],
  },
  {
    title: "Operations",
    items: ["Incidents", "Executions", "Schedules", "Audit Trail"],
  },
  {
    title: "Governance",
    items: ["Policy", "Sources", "Models"],
  },
  {
    title: "Admin",
    items: ["Admin"],
  },
];

const statusPills = [
  ["Operator", "blue"],
  ["Engineering", "amber"],
  ["Incident", "red"],
  ["PROD", "red"],
  ["Auth", "amber"],
  ["LLM Idle", "slate"],
  ["Policy Enforced", "green"],
  ["Sources 128", "cyan"],
  ["State Synced", "purple"],
];

const capabilities = [
  ["Coding Agent", "Write, refactor, test"],
  ["Ops Playbooks", "Automate operations"],
  ["Run Orchestration", "Execute with guardrails"],
  ["Audit Trail", "Trace every action"],
  ["Model Routing", "Intelligent selection"],
  ["Policy Enforcement", "Safe by design"],
];

const starters = [
  ["Investigate latency spike", "Analyze recent latency increase in the API gateway and suggest mitigations.", "Ops"],
  ["Roll out feature flag", "Safely rollout the new checkout experience using progressive delivery.", "Playbook"],
  ["Create runbook", "Generate a runbook for incident: DB connection exhaustion.", "Runbook"],
  ["Refactor Python service", "Review and refactor the order-processing service for performance.", "Code"],
];

const recentRuns = [
  ["checkout-service-deploy", "Succeeded", "2m ago"],
  ["db-failover-automation", "Succeeded", "15m ago"],
  ["api-latency-investigation", "Running", "1h ago"],
  ["user-svc-rollback", "Failed", "3h ago"],
];

const playbooks = [
  ["Deploy Service", "Blue/Green"],
  ["Database Failover", "Resilience"],
  ["Incident Triage", "Incident"],
  ["Rollback Release", "Rollback"],
];

const models = [
  ["Qwen Coder 14B", "Default"],
  ["Qwen3 Coder 30B", "Review"],
  ["DeepSeek R1 32B", "Reasoning"],
  ["Claude/OpenAI", "Fallback"],
];

export default function MigraPilotCommandCenterMock() {
  return (
    <main style={S.page}>
      <aside style={S.sidebar}>
        <div style={S.brandRow}>
          <img src={logo} alt="MigraPilot" style={S.logo} />
          <div>
            <div style={S.brand}>MIGRAPILOT</div>
            <div style={S.brandSub}>AI Command Center</div>
          </div>
        </div>

        <button style={S.newButton}>+ New Session <span style={S.keyHint}>⌘K</span></button>

        <div style={S.search}>Search conversations... <span>⌘/</span></div>

        <nav style={S.nav}>
          {navGroups.map((group) => (
            <section key={group.title} style={S.navGroup}>
              <div style={S.navTitle}>{group.title}</div>
              {group.items.map((item, index) => (
                <div
                  key={item}
                  style={{
                    ...S.navItem,
                    ...(group.title === "Workspace" && index === 0 ? S.navItemActive : {}),
                  }}
                >
                  <span style={S.navDot} />
                  {item}
                </div>
              ))}
            </section>
          ))}
        </nav>

        <div style={S.sidebarBottom}>
          <div style={S.navItem}>⚙ Settings</div>
          <div style={S.operatorCard}>
            <div style={S.avatar}>OP</div>
            <div>
              <div style={S.operatorName}>Operator</div>
              <div style={S.operatorEmail}>operator@migrateck.com</div>
            </div>
          </div>
        </div>
      </aside>

      <section style={S.shell}>
        <header style={S.topbar}>
          <div style={S.pillRow}>
            {statusPills.map(([label, tone]) => (
              <span key={label} style={{ ...S.pill, ...toneStyle(tone) }}>
                <span style={{ ...S.pillDot, background: toneDot(tone) }} />
                {label}
              </span>
            ))}
          </div>

          <div style={S.health}>
            <span style={S.greenDot} />
            <div>
              <div style={S.healthTitle}>System Health</div>
              <div style={S.healthSub}>All Systems Operational</div>
            </div>
            <div style={S.topAvatar}>OP</div>
          </div>
        </header>

        <div style={S.contentGrid}>
          <section style={S.center}>
            <section style={S.hero}>
              <div style={S.heroLogoWrap}>
                <img src={logo} alt="MigraPilot" style={S.heroLogo} />
              </div>
              <h1 style={S.h1}>MigraPilot</h1>
              <p style={S.subtitle}>AI Command Center for Engineering, Operations, and Automation.</p>
            </section>

            <section style={S.capabilityGrid}>
              {capabilities.map(([title, subtitle]) => (
                <article key={title} style={S.capCard}>
                  <div style={S.capIcon}>✦</div>
                  <div>
                    <div style={S.capTitle}>{title}</div>
                    <div style={S.capSub}>{subtitle}</div>
                  </div>
                </article>
              ))}
            </section>

            <section style={S.starterGrid}>
              {starters.map(([title, body, tag]) => (
                <article key={title} style={S.starterCard}>
                  <div style={S.starterTag}>{tag}</div>
                  <h3 style={S.starterTitle}>{title}</h3>
                  <p style={S.starterBody}>{body}</p>
                </article>
              ))}
            </section>

            <section style={S.composer}>
              <div style={S.composerHeader}>Ask MigraPilot anything...</div>
              <div style={S.inputRow}>
                <span style={S.promptIcon}>›</span>
                <span style={S.placeholder}>Type a command, ask a question, or run a playbook...</span>
                <button style={S.sendButton}>↗</button>
              </div>
              <div style={S.actionRow}>
                {[
                  ["Inspect", "Understand state"],
                  ["Plan", "Create a plan"],
                  ["Execute", "Run safely"],
                  ["Verify", "Validate results"],
                  ["Review", "Post-run analysis"],
                ].map(([title, sub]) => (
                  <button key={title} style={S.actionChip}>
                    <strong>{title}</strong>
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
            </section>

            <section style={S.lowerGrid}>
              <Panel title="Recent Runs">
                {recentRuns.map(([name, status, time]) => (
                  <Row key={name} left={name} right={`${status} · ${time}`} tone={status} />
                ))}
              </Panel>

              <Panel title="Playbooks">
                {playbooks.map(([name, tag]) => (
                  <Row key={name} left={name} right={tag} />
                ))}
              </Panel>

              <Panel title="System Health">
                {["Services 98.7%", "Infrastructure 99.9%", "Databases 99.8%", "Queues 99.9%"].map((item) => (
                  <Row key={item} left={item} right="Healthy" tone="Succeeded" />
                ))}
              </Panel>

              <Panel title="Models">
                {models.map(([name, state]) => (
                  <Row key={name} left={name} right={state} />
                ))}
              </Panel>
            </section>
          </section>

          <aside style={S.rightPanel}>
            <div style={S.tabs}>
              {["Context", "Run Details", "Steps", "Logs", "Memory"].map((tab, index) => (
                <span key={tab} style={{ ...S.tab, ...(index === 0 ? S.tabActive : {}) }}>{tab}</span>
              ))}
            </div>

            <Panel title="Live Context">
              <Row left="Environment" right="PROD" tone="Failed" />
              <Row left="Region" right="us-east-1" />
              <Row left="Cluster" right="eks-prod-01" />
              <Row left="User" right="operator@migrateck.com" />
            </Panel>

            <Panel title="Active Run">
              <div style={S.runName}>api-latency-investigation</div>
              <div style={S.progressTrack}><div style={S.progressFill} /></div>
              <div style={S.muted}>65% complete · running safely</div>
            </Panel>

            <Panel title="Execution Steps">
              {["Collect metrics", "Analyze latency drivers", "Correlate deployments", "Identify root cause", "Recommend mitigations"].map((step, index) => (
                <Row key={step} left={`${index + 1}. ${step}`} right={index < 2 ? "Done" : index === 2 ? "Running" : "Pending"} />
              ))}
            </Panel>

            <Panel title="Knowledge Sources">
              <Row left="GitHub" right="Live" />
              <Row left="Docs" right="Synced" />
              <Row left="Run History" right="128" />
              <Row left="Policies" right="Active" />
            </Panel>

            <Panel title="Memory">
              <div style={S.progressTrack}><div style={{ ...S.progressFill, width: "12%" }} /></div>
              <div style={S.muted}>12% of project context used</div>
            </Panel>
          </aside>
        </div>
      </section>
      <style jsx global>{`
        @media (max-width: 1280px) {
          main {
            overflow-x: auto;
          }
        }

        @media (max-width: 1100px) {
          main {
            min-width: 1100px;
          }
        }
      `}</style>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article style={S.panel}>
      <div style={S.panelHeader}>
        <h3 style={S.panelTitle}>{title}</h3>
        <span style={S.panelAction}>View</span>
      </div>
      <div style={S.panelBody}>{children}</div>
    </article>
  );
}

function Row({ left, right, tone }: { left: string; right: string; tone?: string }) {
  const color = tone === "Failed" ? "#ff6b6b" : tone === "Succeeded" ? "#4ade80" : tone === "Running" ? "#38bdf8" : "#94a3b8";
  return (
    <div style={S.row}>
      <span style={S.rowLeft}>{left}</span>
      <span style={{ ...S.rowRight, color }}>{right}</span>
    </div>
  );
}

function toneStyle(tone: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    blue: { color: "#93c5fd", borderColor: "rgba(59,130,246,.42)", background: "rgba(37,99,235,.12)" },
    cyan: { color: "#67e8f9", borderColor: "rgba(34,211,238,.42)", background: "rgba(8,145,178,.12)" },
    green: { color: "#86efac", borderColor: "rgba(34,197,94,.42)", background: "rgba(22,163,74,.12)" },
    amber: { color: "#fde68a", borderColor: "rgba(245,158,11,.42)", background: "rgba(217,119,6,.12)" },
    red: { color: "#fca5a5", borderColor: "rgba(239,68,68,.45)", background: "rgba(185,28,28,.14)" },
    purple: { color: "#d8b4fe", borderColor: "rgba(168,85,247,.42)", background: "rgba(126,34,206,.12)" },
    slate: { color: "#cbd5e1", borderColor: "rgba(148,163,184,.28)", background: "rgba(51,65,85,.22)" },
  };
  return map[tone] ?? map.slate;
}

function toneDot(tone: string) {
  const map: Record<string, string> = {
    blue: "#60a5fa",
    cyan: "#22d3ee",
    green: "#22c55e",
    amber: "#f59e0b",
    red: "#ef4444",
    purple: "#a855f7",
    slate: "#94a3b8",
  };
  return map[tone] ?? "#94a3b8";
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    background:
      "radial-gradient(circle at 20% 0%, rgba(37,99,235,.20), transparent 32%), radial-gradient(circle at 88% 8%, rgba(14,165,233,.16), transparent 30%), #05070d",
    color: "#e5eefc",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  sidebar: {
    width: 272,
    flexShrink: 0,
    minHeight: "100vh",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid rgba(148,163,184,.14)",
    background: "linear-gradient(180deg, rgba(8,12,22,.96), rgba(3,7,18,.98))",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 },
  logo: { width: 42, height: 42, borderRadius: 14, boxShadow: "0 0 28px rgba(56,189,248,.35)" },
  brand: { fontSize: 13, fontWeight: 800, letterSpacing: 1.7 },
  brandSub: { fontSize: 11, color: "#7dd3fc", marginTop: 2 },
  newButton: {
    height: 42,
    border: "1px solid rgba(59,130,246,.55)",
    borderRadius: 14,
    background: "linear-gradient(135deg, #2563eb, #06b6d4)",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    boxShadow: "0 16px 36px rgba(37,99,235,.32)",
  },
  keyHint: { opacity: 0.75, fontSize: 11 },
  search: {
    marginTop: 14,
    height: 38,
    borderRadius: 13,
    border: "1px solid rgba(148,163,184,.16)",
    background: "rgba(15,23,42,.7)",
    color: "#64748b",
    fontSize: 12,
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nav: { marginTop: 18, flex: 1, overflow: "auto", paddingRight: 2 },
  navGroup: { marginBottom: 18 },
  navTitle: { fontSize: 10, color: "#64748b", textTransform: "uppercase", fontWeight: 800, letterSpacing: 1.2, marginBottom: 7 },
  navItem: {
    height: 34,
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "0 10px",
    borderRadius: 11,
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: 600,
  },
  navItemActive: {
    color: "#eff6ff",
    background: "linear-gradient(90deg, rgba(37,99,235,.28), rgba(14,165,233,.10))",
    border: "1px solid rgba(59,130,246,.22)",
  },
  navDot: { width: 7, height: 7, borderRadius: 999, background: "#38bdf8", boxShadow: "0 0 12px rgba(56,189,248,.8)" },
  sidebarBottom: { borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 10, flexShrink: 0 },
  operatorCard: {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 15,
    background: "rgba(15,23,42,.72)",
    border: "1px solid rgba(148,163,184,.14)",
  },
  avatar: {
    width: 35,
    height: 35,
    borderRadius: 12,
    background: "linear-gradient(135deg, #2563eb, #06b6d4)",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
    fontSize: 12,
  },
  operatorName: { fontSize: 13, fontWeight: 800 },
  operatorEmail: { fontSize: 11, color: "#64748b" },
  shell: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  topbar: {
    minHeight: 64,
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderBottom: "1px solid rgba(148,163,184,.13)",
    background: "rgba(2,6,23,.72)",
    backdropFilter: "blur(18px)",
  },
  pillRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    minHeight: 27,
    padding: "0 10px",
    borderRadius: 999,
    border: "1px solid",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.25,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.04), 0 10px 26px rgba(0,0,0,.18)",
  },
  pillDot: { width: 7, height: 7, borderRadius: 999, boxShadow: "0 0 12px currentColor" },
  health: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 16,
    border: "1px solid rgba(34,197,94,.22)",
    background: "rgba(22,101,52,.12)",
  },
  greenDot: { width: 9, height: 9, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 14px rgba(34,197,94,.9)" },
  healthTitle: { fontSize: 11, fontWeight: 800 },
  healthSub: { fontSize: 10, color: "#86efac" },
  topAvatar: { width: 30, height: 30, borderRadius: 999, background: "#0f172a", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, border: "1px solid rgba(148,163,184,.22)" },
  contentGrid: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 348px", gap: 16, padding: 16 },
  center: { minWidth: 0, overflow: "auto", paddingRight: 2 },
  hero: { textAlign: "center", padding: "20px 0 16px" },
  heroLogoWrap: { display: "inline-grid", placeItems: "center", width: 82, height: 82, borderRadius: 26, background: "rgba(14,165,233,.10)", border: "1px solid rgba(56,189,248,.24)", boxShadow: "0 0 60px rgba(56,189,248,.24)" },
  heroLogo: { width: 62, height: 62, borderRadius: 20 },
  h1: { margin: "12px 0 4px", fontSize: 42, lineHeight: 1, letterSpacing: -1.2, fontWeight: 800 },
  subtitle: { margin: 0, color: "#93c5fd", fontSize: 15 },
  capabilityGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 },
  capCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 15,
    borderRadius: 18,
    background: "linear-gradient(180deg, rgba(15,23,42,.82), rgba(15,23,42,.48))",
    border: "1px solid rgba(148,163,184,.14)",
    boxShadow: "0 18px 40px rgba(0,0,0,.20)",
  },
  capIcon: { width: 34, height: 34, borderRadius: 12, display: "grid", placeItems: "center", color: "#67e8f9", background: "rgba(14,165,233,.13)" },
  capTitle: { fontSize: 13, fontWeight: 800 },
  capSub: { marginTop: 3, fontSize: 11, color: "#94a3b8" },
  starterGrid: { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 },
  starterCard: { padding: 14, minHeight: 112, borderRadius: 18, background: "rgba(2,6,23,.58)", border: "1px solid rgba(148,163,184,.13)", boxShadow: "0 14px 34px rgba(0,0,0,.16)" },
  starterTag: { display: "inline-block", padding: "3px 8px", borderRadius: 999, background: "rgba(37,99,235,.16)", color: "#93c5fd", fontSize: 10, fontWeight: 800 },
  starterTitle: { margin: "10px 0 6px", fontSize: 14 },
  starterBody: { margin: 0, color: "#94a3b8", fontSize: 12, lineHeight: 1.45 },
  composer: { marginTop: 14, padding: 14, borderRadius: 22, background: "rgba(15,23,42,.74)", border: "1px solid rgba(56,189,248,.18)", boxShadow: "0 22px 70px rgba(8,145,178,.13)" },
  composerHeader: { fontSize: 13, fontWeight: 800, marginBottom: 10 },
  inputRow: { height: 50, borderRadius: 16, background: "rgba(2,6,23,.78)", border: "1px solid rgba(148,163,184,.14)", display: "flex", alignItems: "center", gap: 10, padding: "0 10px 0 14px" },
  promptIcon: { color: "#38bdf8", fontSize: 24 },
  placeholder: { flex: 1, color: "#64748b", fontSize: 13 },
  sendButton: { width: 38, height: 38, borderRadius: 13, border: 0, background: "linear-gradient(135deg, #2563eb, #06b6d4)", color: "white", fontWeight: 800 },
  actionRow: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 9, marginTop: 10 },
  actionChip: { textAlign: "left", padding: 10, borderRadius: 14, border: "1px solid rgba(148,163,184,.14)", background: "rgba(2,6,23,.46)", color: "#e2e8f0", display: "flex", flexDirection: "column", gap: 3 },
  lowerGrid: { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 },
  rightPanel: { minHeight: 0, overflow: "auto", padding: 12, borderRadius: 24, background: "rgba(2,6,23,.62)", border: "1px solid rgba(148,163,184,.14)" },
  tabs: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  tab: { padding: "6px 8px", borderRadius: 999, fontSize: 11, color: "#94a3b8", background: "rgba(15,23,42,.62)" },
  tabActive: { color: "#e0f2fe", background: "rgba(14,165,233,.18)", border: "1px solid rgba(56,189,248,.24)" },
  panel: { padding: 12, borderRadius: 18, background: "rgba(15,23,42,.66)", border: "1px solid rgba(148,163,184,.13)", marginBottom: 10 },
  panelHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  panelTitle: { margin: 0, fontSize: 13, fontWeight: 800 },
  panelAction: { fontSize: 10, color: "#38bdf8", fontWeight: 800 },
  panelBody: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12 },
  rowLeft: { color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowRight: { color: "#94a3b8", fontWeight: 800, flexShrink: 0 },
  runName: { fontSize: 13, fontWeight: 800, color: "#e0f2fe" },
  progressTrack: { width: "100%", height: 8, borderRadius: 999, background: "rgba(30,41,59,.9)", overflow: "hidden", marginTop: 10 },
  progressFill: { width: "65%", height: "100%", background: "linear-gradient(90deg, #2563eb, #22d3ee)", borderRadius: 999 },
  muted: { marginTop: 8, fontSize: 11, color: "#94a3b8" },
};
