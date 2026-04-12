import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type EnvironmentName = "dev" | "stage" | "staging" | "prod" | "test";
type RunnerTarget = "auto" | "local" | "server";

interface DesktopSettings {
  serverRunnerUrl: string;
  operatorId: string;
  role: string;
  defaultEnvironment: EnvironmentName;
  defaultRunnerTarget: RunnerTarget;
}

interface ServiceStatus {
  name: "console" | "runner-local";
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  managedByDesktop?: boolean;
}

interface ApprovalsResponse {
  ok: boolean;
  data?: {
    approvals: Array<{
      approvalId: string;
      createdAt: string;
      status: "pending" | "approved" | "rejected";
      toolName: string;
      runId: string;
      summary: string;
      risk: string;
      humanKeyTurnCode?: string;
    }>;
  };
}

const params = new URLSearchParams(window.location.search);
const brainUrl = params.get("brainUrl") ?? "http://127.0.0.1:7777";
const consoleUrl = params.get("consoleUrl") ?? "http://127.0.0.1:7776";

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${brainUrl.replace(/\/$/, "")}${path}`, {
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function App() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [status, setStatus] = useState<{
    brain: { running: boolean; port: number; managedByDesktop?: boolean };
    services: Record<string, ServiceStatus>;
  } | null>(null);
  const [consolePath, setConsolePath] = useState("/console");
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [approvals, setApprovals] = useState<ApprovalsResponse["data"]["approvals"]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});

  const iframeSrc = useMemo(() => `${consoleUrl.replace(/\/$/, "")}${consolePath}`, [consolePath]);

  async function loadSettings() {
    const payload = await callApi<{ ok: boolean; data: DesktopSettings }>("/api/settings");
    setSettings(payload.data);
  }

  async function loadStatus() {
    const payload = await callApi<{
      ok: boolean;
      data: {
        brain: { running: boolean; port: number; managedByDesktop?: boolean };
        services: Record<string, ServiceStatus>;
      };
    }>("/api/services/status");
    setStatus(payload.data);
  }

  async function loadLogs(service: "console" | "runner-local") {
    const payload = await callApi<{ ok: boolean; data: { logs: string[] } }>(`/api/services/logs/${service}`);
    setLogs((previous) => ({ ...previous, [service]: payload.data.logs }));
  }

  async function loadApprovals() {
    const payload = await callApi<ApprovalsResponse>("/api/approvals");
    if (payload.ok && payload.data) {
      setApprovals(payload.data.approvals);
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadStatus();
    void loadApprovals();
    void loadLogs("console");
    void loadLogs("runner-local");
    const timer = setInterval(() => {
      void loadStatus();
      void loadApprovals();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  async function saveSettings() {
    if (!settings) return;
    try {
      const payload = await callApi<{ ok: boolean; data: DesktopSettings }>("/api/settings", {
        method: "POST",
        body: JSON.stringify(settings)
      });
      setSettings(payload.data);
      setMessage("Settings saved");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function serviceAction(service: "brain" | "console" | "runner-local", action: "start" | "stop" | "restart") {
    try {
      await callApi(`/api/services/${service}/${action}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage(`${service} ${action} requested`);
      await loadStatus();
      if (service === "console" || service === "runner-local") {
        await loadLogs(service);
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function resolveApproval(approvalId: string, action: "approve" | "reject") {
    try {
      await callApi(`/api/approvals/${approvalId}`, {
        method: "POST",
        body: JSON.stringify({
          action,
          humanKeyTurnCode: action === "approve" ? codes[approvalId] ?? "" : undefined
        })
      });
      setMessage(`Approval ${approvalId} ${action}`);
      await loadApprovals();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  return (
    <div style={{ fontFamily: "Segoe UI, sans-serif", color: "#e7efff", background: "#0b1529", minHeight: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid #243a62",
          background: "#111f39"
        }}
      >
        <strong>MigraPilot Desktop</strong>
        <div style={{ display: "flex", gap: 8 }}>
          {["/console", "/missions", "/inventory", "/journal", "/approvals"].map((route) => (
            <button
              key={route}
              onClick={() => setConsolePath(route)}
              style={{
                border: "1px solid #2c4673",
                background: consolePath === route ? "#2958a8" : "#172845",
                color: "#fff",
                padding: "6px 10px",
                borderRadius: 6,
                cursor: "pointer"
              }}
            >
              {route.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {message ? (
        <div style={{ padding: "8px 14px", fontSize: 13, color: "#95b4f0" }}>{message}</div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 10, padding: 10 }}>
        <aside style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <section style={{ border: "1px solid #243a62", borderRadius: 8, padding: 10, background: "#10203a" }}>
            <h3 style={{ marginTop: 0 }}>Service Status</h3>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              Brain API: {status?.brain.running ? "running" : "down"} on :{status?.brain.port ?? 7777}{" "}
              {status?.brain.managedByDesktop ? "(desktop)" : status?.brain.running ? "(external)" : ""}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={() => void serviceAction("brain", "restart")}>Restart Brain API</button>
            </div>
            {["console", "runner-local"].map((service) => {
              const item = status?.services?.[service as keyof typeof status.services];
              return (
                <div key={service} style={{ borderTop: "1px solid #243a62", paddingTop: 8, marginTop: 8 }}>
                  <div style={{ fontSize: 12 }}>
                    {service}: {item?.running ? "running" : "down"} pid={item?.pid ?? "-"}{" "}
                    {item?.managedByDesktop ? "(desktop)" : item?.running ? "(external)" : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "#92a8d6" }}>{item?.lastError ?? ""}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button onClick={() => void serviceAction(service as "console" | "runner-local", "start")}>Start</button>
                    <button onClick={() => void serviceAction(service as "console" | "runner-local", "stop")}>Stop</button>
                    <button onClick={() => void serviceAction(service as "console" | "runner-local", "restart")}>Restart</button>
                  </div>
                </div>
              );
            })}
          </section>

          <section style={{ border: "1px solid #243a62", borderRadius: 8, padding: 10, background: "#10203a" }}>
            <h3 style={{ marginTop: 0 }}>Settings</h3>
            {settings ? (
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 12 }}>Server runner URL</label>
                <input value={settings.serverRunnerUrl} onChange={(event) => setSettings({ ...settings, serverRunnerUrl: event.target.value })} />
                <label style={{ fontSize: 12 }}>Operator ID</label>
                <input value={settings.operatorId} onChange={(event) => setSettings({ ...settings, operatorId: event.target.value })} />
                <label style={{ fontSize: 12 }}>Role</label>
                <input value={settings.role} onChange={(event) => setSettings({ ...settings, role: event.target.value })} />
                <label style={{ fontSize: 12 }}>Default environment</label>
                <select
                  value={settings.defaultEnvironment}
                  onChange={(event) => setSettings({ ...settings, defaultEnvironment: event.target.value as EnvironmentName })}
                >
                  <option value="dev">dev</option>
                  <option value="stage">stage</option>
                  <option value="staging">staging</option>
                  <option value="prod">prod</option>
                  <option value="test">test</option>
                </select>
                <label style={{ fontSize: 12 }}>Default runner</label>
                <select
                  value={settings.defaultRunnerTarget}
                  onChange={(event) => setSettings({ ...settings, defaultRunnerTarget: event.target.value as RunnerTarget })}
                >
                  <option value="auto">auto</option>
                  <option value="local">local</option>
                  <option value="server">server</option>
                </select>
                <button onClick={() => void saveSettings()}>Save settings</button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#92a8d6" }}>Loading settings...</div>
            )}
          </section>

          <section style={{ border: "1px solid #243a62", borderRadius: 8, padding: 10, background: "#10203a" }}>
            <h3 style={{ marginTop: 0 }}>Tier 3 Approvals</h3>
            {approvals.length === 0 ? (
              <div style={{ fontSize: 12, color: "#92a8d6" }}>No pending approvals.</div>
            ) : (
              approvals.map((approval) => (
                <div key={approval.approvalId} style={{ borderTop: "1px solid #243a62", paddingTop: 8, marginTop: 8 }}>
                  <div style={{ fontSize: 12 }}>{approval.toolName}</div>
                  <div style={{ fontSize: 11, color: "#92a8d6" }}>{approval.approvalId}</div>
                  <div style={{ fontSize: 11, color: "#f7c873" }}>{approval.risk}</div>
                  <input
                    placeholder="humanKeyTurnCode"
                    value={codes[approval.approvalId] ?? ""}
                    onChange={(event) =>
                      setCodes((previous) => ({
                        ...previous,
                        [approval.approvalId]: event.target.value
                      }))
                    }
                    style={{ width: "100%", marginTop: 6 }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button onClick={() => void resolveApproval(approval.approvalId, "approve")}>Approve</button>
                    <button onClick={() => void resolveApproval(approval.approvalId, "reject")}>Reject</button>
                  </div>
                </div>
              ))
            )}
          </section>

          <section style={{ border: "1px solid #243a62", borderRadius: 8, padding: 10, background: "#10203a" }}>
            <h3 style={{ marginTop: 0 }}>Service Logs</h3>
            {["console", "runner-local"].map((service) => (
              <div key={service} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>{service}</div>
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 120,
                    overflow: "auto",
                    fontSize: 11,
                    background: "#081021",
                    border: "1px solid #243a62",
                    borderRadius: 6,
                    padding: 6
                  }}
                >
                  {(logs[service] ?? []).slice(-20).join("\n") || "(no logs)"}
                </pre>
              </div>
            ))}
          </section>
        </aside>

        <section style={{ border: "1px solid #243a62", borderRadius: 8, overflow: "hidden", background: "#081021" }}>
          <iframe
            src={iframeSrc}
            title="MigraPilot Console"
            style={{ width: "100%", height: "calc(100vh - 92px)", border: 0, background: "#081021" }}
          />
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
