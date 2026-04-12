"use client";

import { useEffect, useState } from "react";

import { DEFAULT_CHAT_SETTINGS, type ChatProvider, type ChatSettings } from "@/lib/shared/chat-settings";

export default function SettingsPage() {
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch("/api/chat/settings", { cache: "no-store" });
        const payload = await res.json();
        if (mounted && payload?.ok && payload.data) {
          setSettings(payload.data);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/chat/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        setStatus("Failed to save settings.");
        return;
      }
      setSettings(payload.data);
      setStatus("Saved.");
    } catch {
      setStatus("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>MigraPilot Settings</h1>
      <p style={{ color: "var(--fg-dim)", fontSize: 13 }}>
        Configure default chat behavior for the web portal.
      </p>

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--fg-dim)" }}>Loading settings...</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12 }}>Default Provider</span>
            <select
              value={settings.provider}
              onChange={(e) => setSettings((prev) => ({ ...prev, provider: e.target.value as ChatProvider }))}
              style={{ maxWidth: 260 }}
            >
              <option value="auto">Auto</option>
              <option value="local">Local</option>
              <option value="haiku">Haiku</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12 }}>Default Model (optional)</span>
            <input
              value={settings.model}
              onChange={(e) => setSettings((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="e.g. claude-sonnet-4-6"
              style={{ maxWidth: 420 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12 }}>Default Console Mode</span>
            <select
              value={settings.defaultMode}
              onChange={(e) => setSettings((prev) => ({ ...prev, defaultMode: e.target.value as ChatSettings["defaultMode"] }))}
              style={{ maxWidth: 260 }}
            >
              <option value="chat">Chat</option>
              <option value="plan">Plan Only</option>
              <option value="execute-t01">Execute T0/T1</option>
              <option value="execute-t2">Execute T2</option>
            </select>
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </button>
            {status && <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>{status}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
