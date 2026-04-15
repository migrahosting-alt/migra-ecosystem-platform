"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Button, toBrandStyle } from "@migrateck/auth-ui";
import { authFetch } from "@/lib/api";
import { resolveAuthBrandTheme } from "@/lib/branding";

type SessionRow = {
  id: string;
  session_type?: string;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at?: string;
  last_seen_at?: string | null;
  current?: boolean;
};

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Unavailable";
  }

  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describeBrowser(userAgent: string | null | undefined) {
  if (!userAgent) {
    return "Unknown device";
  }
  if (userAgent.includes("Firefox")) return "Firefox";
  if (userAgent.includes("Chrome")) return "Chrome";
  if (userAgent.includes("Safari")) return "Safari";
  if (userAgent.includes("Edge")) return "Edge";
  return "Browser session";
}

export default function SessionsPage() {
  const brand = useMemo(() => resolveAuthBrandTheme(null), []);
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  const currentSession = useMemo(() => sessions.find((session) => session.current) ?? null, [sessions]);

  useEffect(() => {
    authFetch<{ sessions: SessionRow[] }>("/v1/sessions")
      .then((response) => {
        if (!response.ok) {
          setError("Failed to load sessions.");
          return;
        }

        setSessions(response.data.sessions);
      })
      .catch(() => {
        setError("Network error.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function revokeSession(sessionId: string) {
    setRevoking(sessionId);
    try {
      const response = await authFetch(`/v1/sessions/${sessionId}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Failed to revoke the selected session.");
        return;
      }

      setSessions((current) => current.filter((session) => session.id !== sessionId));
    } catch {
      setError("Network error.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="min-h-screen text-white" style={brandStyle}>
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        {/* ── background ─── */}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#080b20_0%,#0f1733_48%,#080b20_100%)]" />
        <div className="pointer-events-none absolute -left-40 top-16 h-[500px] w-[500px] rounded-full blur-[120px]" style={{ background: "var(--brand-start)", opacity: 0.18 }} />
        <div className="pointer-events-none absolute -right-32 bottom-16 h-[400px] w-[400px] rounded-full blur-[100px]" style={{ background: "var(--brand-end)", opacity: 0.14 }} />
        <div className="absolute inset-0 -z-10 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent)]" />

        <div className="w-full max-w-[640px]">
          {/* ── glass card ─── */}
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.06] p-8 shadow-[0_26px_90px_rgba(3,7,18,0.38)] backdrop-blur-xl sm:p-9">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)]" />
            <div className="pointer-events-none absolute inset-[1px] rounded-[27px] border border-white/[0.06]" />

            <div className="relative space-y-6">
              {/* ── brand badge ─── */}
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl">
                    <Image
                      src="/brands/migrateck-logo.png"
                      alt={brand.productName}
                      fill
                      className="object-contain"
                      priority
                    />
                  </div>
                  <div className="text-left leading-none">
                    <div className="text-lg font-semibold tracking-[-0.02em] text-white">
                      {brand.productName}
                    </div>
                    <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.26em] text-white/50">
                      Session management
                    </div>
                  </div>
                </div>
              </div>

              {/* ── heading ─── */}
              <div className="text-center">
                <h1 className="text-2xl font-semibold tracking-tight text-white">Active sessions</h1>
                <p className="mt-2 text-sm text-white/50">
                  Review device access, revoke stale sessions, and keep your account secure.
                </p>
              </div>

              {/* ── stat row ─── */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-3 text-center">
                  <p className="text-2xl font-bold text-white">{sessions.length}</p>
                  <p className="mt-1 text-[11px] text-white/40">Active</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-3 text-center">
                  <p className="truncate text-sm font-semibold text-white">{describeBrowser(currentSession?.user_agent)}</p>
                  <p className="mt-1 text-[11px] text-white/40">Current device</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-3 text-center">
                  <p className="truncate text-sm font-semibold text-white">{formatDate(currentSession?.created_at)}</p>
                  <p className="mt-1 text-[11px] text-white/40">Latest sign-in</p>
                </div>
              </div>

              {/* ── error ─── */}
              {error ? (
                <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
              ) : null}

              {/* ── session list ─── */}
              <div className="space-y-3">
                {loading ? (
                  <p className="py-6 text-center text-sm text-white/40">Loading sessions…</p>
                ) : sessions.length === 0 ? (
                  <p className="py-6 text-center text-sm text-white/40">No active sessions found.</p>
                ) : (
                  sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`rounded-2xl border px-4 py-4 ${
                        session.current
                          ? "border-[color:var(--brand-start)]/30 bg-[color:var(--brand-start)]/[0.08]"
                          : "border-white/10 bg-black/10"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-white">{describeBrowser(session.user_agent)}</p>
                            {session.current ? (
                              <span className="rounded-full bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                Current
                              </span>
                            ) : null}
                            {session.session_type ? (
                              <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/60">
                                {session.session_type}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-xs text-white/40">
                            {session.ip_address ?? "Unknown IP"} · Last seen {formatDate(session.last_seen_at)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-white/30">Created {formatDate(session.created_at)}</p>
                        </div>

                        {!session.current ? (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => revokeSession(session.id)}
                            disabled={revoking === session.id}
                          >
                            {revoking === session.id ? "Revoking…" : "Revoke"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
