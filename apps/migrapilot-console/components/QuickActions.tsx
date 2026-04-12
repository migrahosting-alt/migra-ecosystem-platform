"use client";

/**
 * QuickActions: Grid of common high-value actions.
 * Intent-driven entry points for the Engineering OS.
 */

/* ── SVG Icons for quick actions ── */
const qaIcons: Record<string, JSX.Element> = {
  inventory: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  health: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  ),
  deploy: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  ),
  drift: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  security: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  build: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  ),
};

interface QuickAction {
  id: string;
  iconKey: string;
  label: string;
  description: string;
  prompt: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "inventory",
    iconKey: "inventory",
    label: "System Inventory",
    description: "Scan tenants, pods, domains, services",
    prompt: "Show me the full system inventory — tenants, pods, and their status",
  },
  {
    id: "health",
    iconKey: "health",
    label: "Health Check",
    description: "Check all services, DNS, DB health",
    prompt: "Run a full health check across all services and report status",
  },
  {
    id: "deploy-status",
    iconKey: "deploy",
    label: "Deploy Status",
    description: "Latest deploys, canary results, drift",
    prompt: "Show the latest deployment status, canary results, and any drift detected",
  },
  {
    id: "drift-scan",
    iconKey: "drift",
    label: "Drift Scan",
    description: "Detect config/state drift across infra",
    prompt: "Run a drift scan and show me what's changed since last snapshot",
  },
  {
    id: "security",
    iconKey: "security",
    label: "Security Posture",
    description: "RBAC gaps, exposed endpoints, certs",
    prompt: "Audit security posture — check RBAC coverage, exposed endpoints, and certificate status",
  },
  {
    id: "build",
    iconKey: "build",
    label: "Build & Ship",
    description: "Build, test, and deploy a service",
    prompt: "I want to build and deploy a service — help me plan the steps",
  },
];

interface QuickActionsProps {
  onSelect: (prompt: string) => void;
}

export function QuickActions({ onSelect }: QuickActionsProps) {
  return (
    <div className="quick-actions fade-in">
      <div style={{
        textAlign: "center", marginBottom: 36, padding: "0 16px"
      }}>
        <div style={{
          width: 52, height: 52, margin: "0 auto 16px",
          borderRadius: 14, background: "var(--accent-glow)",
          border: "1px solid rgba(56, 189, 248, 0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", marginBottom: 6, letterSpacing: -0.4 }}>
          MigraPilot Console
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-dim)", maxWidth: 420, margin: "0 auto", lineHeight: 1.55 }}>
          Your engineering OS for infrastructure operations, deployments,
          and platform management.
        </div>
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingLeft: 4 }}>
        Quick actions
      </div>

      <div className="quick-actions-grid">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            className="quick-action-card"
            onClick={() => onSelect(action.prompt)}
          >
            <div className="quick-action-icon" style={{ color: "var(--accent)" }}>{qaIcons[action.iconKey]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
                {action.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.4 }}>
                {action.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
