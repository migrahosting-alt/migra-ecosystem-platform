"use client";

import { useState } from "react";

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

type RichRow = { title: string; sub: string; status: string; tone: string };

const sectionSubtitles: Record<string, string> = {
  Agents: "Specialized AI agents available to operate your systems.",
  Playbooks: "Reusable, guardrailed automation procedures.",
  Runs: "Recent and in-flight executions across your environments.",
  Incidents: "Active and recent incidents requiring attention.",
  Executions: "Detailed execution history with status and timing.",
  Schedules: "Scheduled jobs and recurring automation windows.",
  "Audit Trail": "Immutable record of every action taken in the platform.",
  Policy: "Guardrails enforced before any execution runs.",
  Sources: "Connected knowledge the assistant uses for grounded answers.",
  Models: "Model routing and roles for safe, cost-aware execution.",
  Admin: "Workspace administration and access controls.",
};

const agentMeta: Record<string, { status: string; tone: string; scope: string; action: string }> = {
  "Coding Agent": { status: "Ready", tone: "green", scope: "Engineering", action: "Configure" },
  "Ops Playbooks": { status: "Ready", tone: "green", scope: "Operations", action: "Open" },
  "Run Orchestration": { status: "Active", tone: "cyan", scope: "Execution", action: "Open" },
  "Audit Trail": { status: "Monitoring", tone: "blue", scope: "Governance", action: "Open" },
  "Model Routing": { status: "Ready", tone: "green", scope: "Platform", action: "Configure" },
  "Policy Enforcement": { status: "Enforced", tone: "purple", scope: "Security", action: "Configure" },
};

const playbookMeta: Record<string, { safety: string; safetyTone: string; lastRun: string; status: string; statusTone: string }> = {
  "Deploy Service": { safety: "Guarded", safetyTone: "amber", lastRun: "2m ago", status: "Ready", statusTone: "green" },
  "Database Failover": { safety: "High-risk", safetyTone: "red", lastRun: "15m ago", status: "Ready", statusTone: "green" },
  "Incident Triage": { safety: "Standard", safetyTone: "blue", lastRun: "1h ago", status: "Idle", statusTone: "slate" },
  "Rollback Release": { safety: "Guarded", safetyTone: "amber", lastRun: "3h ago", status: "Ready", statusTone: "green" },
};

const runTone: Record<string, string> = { Succeeded: "green", Running: "cyan", Failed: "red" };
const runProgress: Record<string, number> = { Succeeded: 100, Running: 65, Failed: 100 };

const knowledgeSources: string[][] = [
  ["GitHub", "Code & pull requests", "Live", "green"],
  ["Docs", "Confluence space", "Synced", "blue"],
  ["Run History", "128 indexed records", "Indexed", "cyan"],
  ["Policies", "Active guardrail set", "Active", "purple"],
];

const opsData: Record<string, RichRow[]> = {
  Incidents: [
    { title: "API gateway latency", sub: "p95 elevated · us-east-1", status: "Investigating", tone: "amber" },
    { title: "DB connection exhaustion", sub: "primary pool · contained", status: "Mitigated", tone: "green" },
    { title: "Cache eviction storm", sub: "redis-prod-02", status: "Monitoring", tone: "blue" },
  ],
  Schedules: [
    { title: "Nightly DB backup", sub: "Daily · 02:00 UTC", status: "Scheduled", tone: "blue" },
    { title: "Weekly dependency audit", sub: "Mon · 06:00 UTC", status: "Scheduled", tone: "blue" },
    { title: "Hourly health sweep", sub: "Every 60 minutes", status: "Active", tone: "green" },
  ],
  "Audit Trail": [
    { title: "Deployed checkout-service", sub: "operator@migrateck.com", status: "2m ago", tone: "slate" },
    { title: "PROD guardrails passed", sub: "policy engine", status: "2m ago", tone: "green" },
    { title: "Opened api-latency-investigation", sub: "operator@migrateck.com", status: "1h ago", tone: "slate" },
  ],
};

const govPolicies: RichRow[] = [
  { title: "PROD change approval", sub: "Requires operator confirmation", status: "Enforced", tone: "green" },
  { title: "Destructive action block", sub: "Drops & deletes require review", status: "Enforced", tone: "green" },
  { title: "Secret access scope", sub: "Least-privilege by default", status: "Enforced", tone: "green" },
];

const adminStats: string[][] = [
  ["4 active", "Members"],
  ["3 defined", "Roles"],
  ["90 days", "Audit retention"],
  ["Enabled", "SSO"],
];

const adminRows: RichRow[] = [
  { title: "Operator", sub: "operator@migrateck.com", status: "Owner", tone: "blue" },
  { title: "Engineering", sub: "team · 2 members", status: "Member", tone: "slate" },
  { title: "Access policy", sub: "Least-privilege enforced", status: "Active", tone: "green" },
];

export default function MigraPilotCommandCenterMock() {
  const [activeSection, setActiveSection] = useState("Conversations");
  const [activeCapability, setActiveCapability] = useState<string[] | null>(null);
  const [activeMode, setActiveMode] = useState("Plan");
  const [activeTab, setActiveTab] = useState("Context");
  const [composerText, setComposerText] = useState("");

  const resetSession = () => {
    setActiveSection("Conversations");
    setActiveCapability(null);
    setActiveMode("Plan");
    setActiveTab("Context");
    setComposerText("");
  };

  return (
    <main className="migrapilot-command-center" style={S.page}>
      <aside style={S.sidebar}>
        <div style={S.brandRow}>
          <img src={logo} alt="MigraPilot" style={S.logo} />
          <div>
            <div style={S.brand}>MIGRAPILOT</div>
            <div style={S.brandSub}>AI Command Center</div>
          </div>
        </div>

        <button style={S.newButton} onClick={resetSession} onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }} onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>+ New Session <span style={S.keyHint}>⌘K</span></button>

        <div style={S.search}>Search conversations... <span>⌘/</span></div>

        <nav style={S.nav}>
          {navGroups.map((group) => (
            <section key={group.title} style={S.navGroup}>
              <div style={S.navTitle}>{group.title}</div>
              {group.items.map((item) => (
                <div
                  key={item}
                  onClick={() => setActiveSection(item)}
                  style={{
                    ...S.navItem,
                    cursor: "pointer",
                    ...(item === activeSection ? S.navItemActive : {}),
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
            <span style={{ ...S.greenDot, ...S.livePulse }} />
            <div>
              <div style={S.healthTitle}>System Health</div>
              <div style={S.healthSub}>All Systems Operational</div>
            </div>
            <div style={S.topAvatar}>OP</div>
          </div>
        </header>

        <div style={S.contentGrid}>
          <section style={S.center}>
            {activeSection === "Conversations" ? (
              <>
            <section style={S.hero}>
              <div style={S.heroLogoWrap}>
                <img src={logo} alt="MigraPilot" style={S.heroLogo} />
              </div>
              <h1 style={S.h1}>MigraPilot</h1>
              <p style={S.subtitle}>AI Command Center for Engineering, Operations, and Automation.</p>
            </section>

            <section style={S.capabilityGrid}>
              {capabilities.map(([title, subtitle]) => {
                const selected = activeCapability?.[0] === title;
                return (
                  <article key={title} onClick={() => setActiveCapability([title, subtitle])} style={{ ...S.capCard, ...(selected ? S.capCardActive : {}) }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(56,189,248,.34)"; e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = selected ? "rgba(56,189,248,.5)" : "rgba(148,163,184,.14)"; e.currentTarget.style.transform = "translateY(0)"; }}>
                    <div style={S.capIcon}>✦</div>
                    <div>
                      <div style={S.capTitle}>{title}</div>
                      <div style={S.capSub}>{subtitle}</div>
                    </div>
                  </article>
                );
              })}
            </section>

            <section style={S.starterGrid}>
              {starters.map(([title, body, tag]) => (
                <article key={title} onClick={() => setComposerText(body)} style={S.starterCard} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(59,130,246,.36)"; e.currentTarget.style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(148,163,184,.13)"; e.currentTarget.style.transform = "translateY(0)"; }}>
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
                <textarea
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  placeholder="Type a command, ask a question, or run a playbook..."
                  style={S.composerInput}
                />
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
                  <button key={title} onClick={() => setActiveMode(title)} style={{ ...S.actionChip, ...(title === activeMode ? S.actionChipActive : {}) }}>
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
              </>
            ) : (
              <SectionView section={activeSection} activeCapability={activeCapability} onSelectCapability={setActiveCapability} />
            )}
          </section>

          <aside style={S.rightPanel}>
            <div style={S.tabs}>
              {["Context", "Run Details", "Steps", "Logs", "Memory"].map((tab) => (
                <span key={tab} onClick={() => setActiveTab(tab)} style={{ ...S.tab, cursor: "pointer", ...(tab === activeTab ? S.tabActive : {}) }}>{tab}</span>
              ))}
            </div>

            {activeTab === "Context" && (
              <>
                <Panel title="Live Context">
                  <Row left="Environment" right="PROD" tone="Failed" />
                  <Row left="Region" right="us-east-1" />
                  <Row left="Cluster" right="eks-prod-01" />
                  <Row left="User" right="operator@migrateck.com" />
                </Panel>

                <Panel title="Capability Focus">
                  {activeCapability ? (
                    <>
                      <Row left={activeCapability[0]} right="Selected" tone="Running" />
                      <div style={S.muted}>{activeCapability[1]}</div>
                    </>
                  ) : (
                    <div style={S.muted}>Select a capability above to focus its context.</div>
                  )}
                </Panel>

                <Panel title="Knowledge Sources">
                  <Row left="GitHub" right="Live" />
                  <Row left="Docs" right="Synced" />
                  <Row left="Run History" right="128" />
                  <Row left="Policies" right="Active" />
                </Panel>
              </>
            )}

            {activeTab === "Run Details" && (
              <Panel title="Active Run">
                <div style={S.runName}><span style={{ ...S.tinyPulse, marginRight: 8 }} />api-latency-investigation</div>
                <div style={S.progressTrack}><div style={S.progressFill} /></div>
                <div style={S.muted}>65% complete · running safely</div>
              </Panel>
            )}

            {activeTab === "Steps" && (
              <Panel title="Execution Steps">
                {["Collect metrics", "Analyze latency drivers", "Correlate deployments", "Identify root cause", "Recommend mitigations"].map((step, index) => (
                  <Row key={step} left={`${index + 1}. ${step}`} right={index < 2 ? "Done" : index === 2 ? "Running" : "Pending"} />
                ))}
              </Panel>
            )}

            {activeTab === "Logs" && (
              <Panel title="Logs">
                {[
                  ["10:42:01", "Run started: api-latency-investigation"],
                  ["10:42:04", "Collected gateway metrics (last 1h)"],
                  ["10:42:09", "Analyzing latency drivers"],
                  ["10:42:15", "Correlating recent deployments"],
                ].map(([time, msg]) => (
                  <Row key={time} left={msg} right={time} />
                ))}
              </Panel>
            )}

            {activeTab === "Memory" && (
              <Panel title="Memory">
                <div style={S.progressTrack}><div style={{ ...S.progressFill, width: "12%" }} /></div>
                <div style={S.muted}>12% of project context used</div>
              </Panel>
            )}
          </aside>
        </div>
      </section>
      <style jsx global>{`
        .migrapilot-command-center * {
          box-sizing: border-box;
        }

        .migrapilot-command-center textarea::placeholder {
          color: #64748b;
        }

        .migrapilot-command-center .mp-card {
          transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease;
          cursor: pointer;
        }

        .migrapilot-command-center .mp-card:hover {
          transform: translateY(-2px);
          border-color: rgba(56,189,248,.34);
          box-shadow: 0 22px 50px rgba(8,145,178,.20);
        }

        .migrapilot-command-center .mp-richrow {
          transition: background .16s ease;
        }

        .migrapilot-command-center .mp-richrow:hover {
          background: rgba(56,189,248,.06);
        }

        @media (max-width: 1280px) {
          .migrapilot-command-center {
            overflow-x: auto;
          }
        }

        @media (max-width: 1100px) {
          .migrapilot-command-center {
            min-width: 1100px;
          }
        }

        @keyframes migrapilotPulse {
          0% { opacity: .55; transform: scale(.92); }
          50% { opacity: 1; transform: scale(1.08); }
          100% { opacity: .55; transform: scale(.92); }
        }
      `}</style>
    </main>
  );
}

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span style={{ ...S.pill, ...toneStyle(tone) }}>
      <span style={{ ...S.pillDot, background: toneDot(tone) }} />
      {label}
    </span>
  );
}

function RichPanel({ title, rows }: { title: string; rows: RichRow[] }) {
  return (
    <article style={S.richPanel}>
      <div style={S.panelHeader}>
        <h3 style={S.panelTitle}>{title}</h3>
        <span style={S.panelAction}>View all</span>
      </div>
      <div style={S.richBody}>
        {rows.map((r) => (
          <div key={r.title} className="mp-richrow" style={S.richRow}>
            <span style={{ ...S.richDot, background: toneDot(r.tone), boxShadow: `0 0 12px ${toneDot(r.tone)}` }} />
            <div style={S.richMain}>
              <div style={S.richTitle}>{r.title}</div>
              <div style={S.richSub}>{r.sub}</div>
            </div>
            <StatusPill label={r.status} tone={r.tone} />
          </div>
        ))}
      </div>
    </article>
  );
}

function SectionView({ section, activeCapability, onSelectCapability }: { section: string; activeCapability: string[] | null; onSelectCapability: (cap: string[]) => void }) {
  const richMap: Record<string, { title: string; rows: RichRow[] }> = {
    Incidents: { title: "Incidents", rows: opsData.Incidents },
    Schedules: { title: "Schedules", rows: opsData.Schedules },
    "Audit Trail": { title: "Activity", rows: opsData["Audit Trail"] },
    Executions: { title: "Executions", rows: recentRuns.map(([name, status, time]) => ({ title: name, sub: `PROD · ${time}`, status, tone: runTone[status] ?? "slate" })) },
    Policy: { title: "Policies", rows: govPolicies },
    Sources: { title: "Knowledge Sources", rows: knowledgeSources.map(([name, type, status, tone]) => ({ title: name, sub: type, status, tone })) },
    Models: { title: "Models", rows: models.map(([name, role], i) => ({ title: name, sub: `${role} model`, status: i === 0 ? "Primary" : "Available", tone: i === 0 ? "green" : "slate" })) },
  };

  return (
    <>
      <section style={S.sectionHead}>
        <h2 style={S.sectionTitle}>{section}</h2>
        <p style={S.sectionSub}>{sectionSubtitles[section] ?? "Part of the MigraPilot command center."}</p>
      </section>

      {section === "Agents" && (
        <section style={S.cardGrid3}>
          {capabilities.map(([name, purpose]) => {
            const meta = agentMeta[name];
            const selected = activeCapability?.[0] === name;
            return (
              <article key={name} className="mp-card" onClick={() => onSelectCapability([name, purpose])} style={{ ...S.agentCard, ...(selected ? S.capCardActive : {}) }}>
                <div style={S.agentTop}>
                  <div style={S.capIcon}>✦</div>
                  <StatusPill label={meta?.status ?? "Ready"} tone={meta?.tone ?? "green"} />
                </div>
                <div style={S.agentName}>{name}</div>
                <div style={S.agentPurpose}>{purpose}</div>
                <div style={S.agentFoot}>
                  <span style={S.scopeTag}>{meta?.scope ?? "General"}</span>
                  <span style={S.cardAction}>{meta?.action ?? "Open"} →</span>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {section === "Playbooks" && (
        <section style={S.cardGrid2}>
          {playbooks.map(([name, category]) => {
            const m = playbookMeta[name];
            return (
              <article key={name} className="mp-card" style={S.agentCard}>
                <div style={S.agentTop}>
                  <span style={S.scopeTag}>{category}</span>
                  <StatusPill label={m?.status ?? "Ready"} tone={m?.statusTone ?? "green"} />
                </div>
                <div style={S.agentName}>{name}</div>
                <div style={S.pbMetaRow}>
                  <div style={S.pbMeta}><span style={S.pbMetaLabel}>Safety</span><StatusPill label={m?.safety ?? "Standard"} tone={m?.safetyTone ?? "blue"} /></div>
                  <div style={S.pbMeta}><span style={S.pbMetaLabel}>Last run</span><span style={S.pbMetaVal}>{m?.lastRun ?? "—"}</span></div>
                </div>
                <div style={S.agentFoot}>
                  <span style={S.cardAction}>Open playbook →</span>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {section === "Runs" && (
        <section style={S.runList}>
          {recentRuns.map(([name, status, time]) => {
            const tone = runTone[status] ?? "slate";
            const pct = runProgress[status] ?? 50;
            return (
              <article key={name} className="mp-card" style={S.runCard}>
                <div style={S.runCardTop}>
                  <div>
                    <div style={S.agentName}>{name}</div>
                    <div style={S.runMeta}>PROD · {time}</div>
                  </div>
                  <StatusPill label={status} tone={tone} />
                </div>
                <div style={S.progressTrack}><div style={{ ...S.progressFill, width: `${pct}%`, background: `linear-gradient(90deg, ${toneDot(tone)}, #22d3ee)` }} /></div>
              </article>
            );
          })}
        </section>
      )}

      {section === "Admin" && (
        <>
          <section style={S.statGrid}>
            {adminStats.map(([value, label]) => (
              <div key={label} style={S.statTile}>
                <div style={S.statValue}>{value}</div>
                <div style={S.statLabel}>{label}</div>
              </div>
            ))}
          </section>
          <section style={S.sectionGrid}>
            <RichPanel title="Access & Roles" rows={adminRows} />
          </section>
        </>
      )}

      {richMap[section] && (
        <section style={S.sectionGrid}>
          <RichPanel title={richMap[section].title} rows={richMap[section].rows} />
        </section>
      )}
    </>
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
    transition: "transform .16s ease, box-shadow .16s ease",
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
  livePulse: { animation: "migrapilotPulse 1.8s ease-in-out infinite" },
  tinyPulse: { display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "#22d3ee", boxShadow: "0 0 14px rgba(34,211,238,.8)", animation: "migrapilotPulse 1.6s ease-in-out infinite" },
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
    transition: "transform .16s ease, border-color .16s ease, box-shadow .16s ease",
    cursor: "pointer",
  },
  capCardActive: { borderColor: "rgba(56,189,248,.5)", boxShadow: "0 0 0 1px rgba(56,189,248,.18), 0 18px 40px rgba(8,145,178,.18)" },
  capIcon: { width: 34, height: 34, borderRadius: 12, display: "grid", placeItems: "center", color: "#67e8f9", background: "rgba(14,165,233,.13)" },
  capTitle: { fontSize: 13, fontWeight: 800 },
  capSub: { marginTop: 3, fontSize: 11, color: "#94a3b8" },
  starterGrid: { marginTop: 12, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 },
  starterCard: { padding: 14, minHeight: 112, borderRadius: 18, background: "rgba(2,6,23,.58)", border: "1px solid rgba(148,163,184,.13)", boxShadow: "0 14px 34px rgba(0,0,0,.16)", transition: "transform .16s ease, border-color .16s ease, box-shadow .16s ease", cursor: "pointer" },
  starterTag: { display: "inline-block", padding: "3px 8px", borderRadius: 999, background: "rgba(37,99,235,.16)", color: "#93c5fd", fontSize: 10, fontWeight: 800 },
  starterTitle: { margin: "10px 0 6px", fontSize: 14 },
  starterBody: { margin: 0, color: "#94a3b8", fontSize: 12, lineHeight: 1.45 },
  composer: { marginTop: 14, padding: 14, borderRadius: 22, background: "rgba(15,23,42,.74)", border: "1px solid rgba(56,189,248,.18)", boxShadow: "0 22px 70px rgba(8,145,178,.13)" },
  composerHeader: { fontSize: 13, fontWeight: 800, marginBottom: 10 },
  inputRow: { height: 50, borderRadius: 16, background: "rgba(2,6,23,.78)", border: "1px solid rgba(148,163,184,.14)", display: "flex", alignItems: "center", gap: 10, padding: "0 10px 0 14px" },
  promptIcon: { color: "#38bdf8", fontSize: 24 },
  placeholder: { flex: 1, color: "#64748b", fontSize: 13 },
  composerInput: { flex: 1, background: "transparent", border: 0, outline: "none", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "none", height: 22, lineHeight: "22px", padding: 0 },
  sendButton: { width: 38, height: 38, borderRadius: 13, border: 0, background: "linear-gradient(135deg, #2563eb, #06b6d4)", color: "white", fontWeight: 800 },
  actionRow: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 9, marginTop: 10 },
  actionChip: { textAlign: "left", padding: 10, borderRadius: 14, border: "1px solid rgba(148,163,184,.14)", background: "rgba(2,6,23,.46)", color: "#e2e8f0", display: "flex", flexDirection: "column", gap: 3, cursor: "pointer", transition: "border-color .16s ease, background .16s ease, transform .16s ease" },
  actionChipActive: { borderColor: "rgba(56,189,248,.44)", background: "linear-gradient(135deg, rgba(37,99,235,.20), rgba(8,145,178,.10))", boxShadow: "0 0 0 1px rgba(56,189,248,.06), 0 16px 38px rgba(8,145,178,.12)" },
  lowerGrid: { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 },
  sectionHead: { padding: "8px 0 18px" },
  sectionTitle: { margin: "0 0 6px", fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#eaf2ff" },
  sectionSub: { margin: 0, color: "#93c5fd", fontSize: 14 },
  sectionGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, alignItems: "start" },
  cardGrid3: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 },
  cardGrid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 },
  agentCard: { display: "flex", flexDirection: "column", gap: 9, padding: 16, minHeight: 156, borderRadius: 18, background: "linear-gradient(180deg, rgba(15,23,42,.82), rgba(15,23,42,.48))", border: "1px solid rgba(148,163,184,.14)", boxShadow: "0 18px 40px rgba(0,0,0,.20)" },
  agentTop: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  agentName: { fontSize: 15, fontWeight: 800, color: "#eaf2ff" },
  agentPurpose: { fontSize: 12, color: "#94a3b8", lineHeight: 1.45, flex: 1 },
  agentFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" },
  scopeTag: { padding: "3px 9px", borderRadius: 999, background: "rgba(37,99,235,.16)", color: "#93c5fd", fontSize: 10, fontWeight: 800 },
  cardAction: { fontSize: 11, color: "#38bdf8", fontWeight: 800 },
  pbMetaRow: { display: "flex", gap: 22, marginTop: 2 },
  pbMeta: { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" },
  pbMetaLabel: { fontSize: 10, color: "#64748b", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8 },
  pbMetaVal: { fontSize: 12, color: "#cbd5e1", fontWeight: 700 },
  runList: { display: "flex", flexDirection: "column", gap: 10 },
  runCard: { padding: 14, borderRadius: 18, background: "rgba(15,23,42,.66)", border: "1px solid rgba(148,163,184,.13)" },
  runCardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  runMeta: { fontSize: 11, color: "#94a3b8", marginTop: 3 },
  richPanel: { padding: 14, borderRadius: 18, background: "rgba(15,23,42,.66)", border: "1px solid rgba(148,163,184,.13)" },
  richBody: { display: "flex", flexDirection: "column" },
  richRow: { display: "flex", alignItems: "center", gap: 12, padding: "11px 6px", borderRadius: 12 },
  richDot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  richMain: { flex: 1, minWidth: 0 },
  richTitle: { fontSize: 13, fontWeight: 700, color: "#e5eefc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  richSub: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12 },
  statTile: { padding: 14, borderRadius: 16, background: "linear-gradient(180deg, rgba(15,23,42,.82), rgba(15,23,42,.48))", border: "1px solid rgba(148,163,184,.14)" },
  statValue: { fontSize: 20, fontWeight: 800, color: "#eaf2ff" },
  statLabel: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
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
