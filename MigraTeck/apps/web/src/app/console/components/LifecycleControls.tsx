"use client";

import { useState } from "react";

/**
 * Operator lifecycle controls.
 *
 * The one thing this component must never do is flash "Success" when a command
 * was merely accepted. The whole point of the slice behind it is the difference
 * between "we sent it" and "we watched it happen", so the UI shows the phases
 * separately and only turns green on a verified observation with a timestamp
 * and a named source.
 *
 * Actions are offered only when they are valid for the observed state: a running
 * guest gets Shutdown and Restart, a stopped guest gets Start. The server
 * refuses invalid combinations regardless, but offering an impossible control
 * and then explaining why it failed is a worse experience than not offering it.
 */

type Action = "start" | "shutdown" | "restart";

const HUMAN_SUCCESS: Record<Action, string> = {
  start: "The guest is powered on and running.",
  shutdown: "The guest has stopped.",
  restart: "The guest process was replaced and is running normally.",
};

type Outcome = {
  ok: boolean;
  action?: Action;
  result?: {
    finalPhase: string;
    failureClass?: string;
    message: string;
    observedAfter?: { status: string | null; uptime: number | null; pid: number | null; observedAt: string } | null;
    verificationSource?: string;
    steps?: Array<{ phase: string; at: string; detail: string }>;
  };
  error?: string;
  message?: string;
};

const COPY: Record<Action, { verb: string; impact: string; tone: "normal" | "strong" }> = {
  start: {
    verb: "Start",
    impact: "The guest will be powered on. Services inside it may take longer to become ready than the guest itself.",
    tone: "normal",
  },
  restart: {
    verb: "Restart",
    impact: "This will interrupt everything running on this guest while it reboots. Connections in progress will be dropped.",
    tone: "strong",
  },
  shutdown: {
    verb: "Shut down",
    impact:
      "This will stop the guest completely. It will stay off until someone starts it again — nothing restarts it automatically.",
    tone: "strong",
  },
};

export function LifecycleControls({
  vmid,
  nodeName,
  currentStatus,
  observedAt,
  services,
  allowedActions,
}: {
  vmid: number;
  nodeName: string;
  currentStatus: string | null;
  observedAt: string | null;
  services: string[];
  /** Per-node allowlist from the control plane. A tier never implies all three. */
  allowedActions: Action[];
}) {
  const [pending, setPending] = useState<Action | null>(null);
  const [running, setRunning] = useState<Action | null>(null);
  const [phase, setPhase] = useState<"executing" | "verifying" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const isRunning = currentStatus === "running";
  const isStopped = currentStatus === "stopped";
  // Unknown state offers nothing: we will not invite an action we cannot reason about.
  // Valid for the observed state AND permitted for this node. Both, always:
  // state alone would offer Restart on a node only allowed to Start.
  const validForState: Action[] = isRunning ? ["restart", "shutdown"] : isStopped ? ["start"] : [];
  const available: Action[] = validForState.filter((a) => allowedActions.includes(a));

  const run = async (action: Action) => {
    setPending(null);
    setRunning(action);
    setOutcome(null);
    setPhase("executing");
    // The request does not stream, so this marks the point after which the
    // command has been dispatched and the control plane is watching the guest.
    const toVerifying = setTimeout(() => setPhase("verifying"), 1200);
    try {
      const res = await fetch("/console/api/infrastructure/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, vmid, reason: `${COPY[action].verb} requested from Infrastructure` }),
      });
      const parsed = (await res.json()) as Outcome;
      setOutcome({ ...parsed, action });
    } catch {
      setOutcome({
        ok: false,
        error: "network",
        message: "The browser lost contact before an answer arrived. Re-check the guest's state before retrying.",
      });
    } finally {
      clearTimeout(toVerifying);
      setPhase(null);
      setRunning(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <span className="text-[11px] font-medium text-slate-300">Power</span>
        <span className="text-[10px] text-slate-500">
          {currentStatus ? `${currentStatus}` : "state unknown"}
          {observedAt ? ` · observed ${new Date(observedAt).toISOString().replace("T", " ").slice(11, 19)}Z` : ""}
        </span>
      </div>

      <div className="px-4 py-3">
        {available.length === 0 ? (
          <p className="text-xs text-slate-400">
            <span className="text-slate-400">—</span>
            <span className="ml-2 text-[11px] text-slate-500">
              No power actions are offered while this guest&apos;s state is unknown.
            </span>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((a) => (
              <button
                key={a}
                type="button"
                disabled={running !== null}
                onClick={() => setPending(a)}
                className={[
                  "rounded-lg border px-3.5 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                  COPY[a].tone === "strong"
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-200 hover:border-amber-400/50 hover:bg-amber-500/15"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/50 hover:bg-emerald-500/15",
                ].join(" ")}
              >
                {COPY[a].verb}
              </button>
            ))}
          </div>
        )}

        {/* ── confirmation: target, real current state, and what it costs ── */}
        {pending ? (
          <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/[0.05] p-4">
            <p className="text-sm font-semibold text-white">
              {COPY[pending].verb} {nodeName}?
            </p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Target</dt>
                <dd className="text-slate-200">
                  {nodeName} <span className="text-slate-500">· guest {vmid}</span>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Current state</dt>
                <dd className="text-slate-200">
                  {currentStatus ?? "unknown"}
                  {observedAt ? (
                    <span className="ml-2 text-slate-500">
                      observed {new Date(observedAt).toISOString().replace("T", " ").slice(11, 19)}Z
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Impact</dt>
                <dd className="leading-relaxed text-slate-200">{COPY[pending].impact}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-slate-500">Affected</dt>
                <dd className="leading-relaxed text-slate-200">
                  {services.length > 0 ? (
                    services.join(", ")
                  ) : (
                    <span className="text-slate-400">
                      No role-critical services are declared for this guest, so the effect on services
                      cannot be listed.
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => run(pending)}
                className="rounded-lg border border-amber-400/40 bg-amber-500/20 px-3.5 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30"
              >
                {COPY[pending].verb} {nodeName}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── progress: the two phases stay visibly distinct ── */}
        {running ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-white">
              {COPY[running].verb === "Shut down" ? "Shutting down" : `${COPY[running].verb}ing`} {nodeName}
            </p>
            <ul className="mt-2 space-y-1.5 text-xs">
              <li className="text-emerald-300">✓ Request authorized</li>
              <li className={phase === "verifying" ? "text-emerald-300" : "text-slate-300"}>
                {phase === "verifying" ? "✓" : "●"} Command sent to the control authority
              </li>
              <li className={phase === "verifying" ? "text-slate-300" : "text-slate-500"}>
                {phase === "verifying" ? "●" : "○"} Verifying against a fresh observation…
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">
              Success is not reported until the guest has been observed in the expected state.
            </p>
          </div>
        ) : null}

        {/* ── outcome ── */}
        {outcome ? (
          <div
            className={[
              "mt-3 rounded-lg border p-4",
              outcome.ok
                ? "border-emerald-400/25 bg-emerald-500/[0.06]"
                : "border-rose-400/25 bg-rose-500/[0.06]",
            ].join(" ")}
          >
            <p className={`text-sm font-semibold ${outcome.ok ? "text-emerald-200" : "text-rose-200"}`}>
              {outcome.ok
                ? `${outcome.action ? COPY[outcome.action].verb : "Action"} verified`
                : outcome.error === "lifecycle_operation_in_progress"
                  ? "Another operation is running"
                  : "Not verified"}
            </p>
            {/* Plain sentence first. The evidence is real and stays available
                below, but an operator should not have to read a pid diff to know
                whether their action worked. */}
            <p className="mt-1 text-xs leading-relaxed text-slate-200">
              {outcome.ok && outcome.action
                ? HUMAN_SUCCESS[outcome.action]
                : (outcome.result?.message ?? outcome.message ?? outcome.error)}
            </p>
            {outcome.ok && outcome.result?.message ? (
              <p className="mt-2 text-[11px] text-slate-500">
                <span className="text-slate-400">Details:</span>{" "}
                {outcome.result.message.replace(/^Verified — /, "")}
              </p>
            ) : null}
            {outcome.result?.observedAfter ? (
              <p className="mt-2 text-[11px] text-slate-400">
                Now {outcome.result.observedAfter.status} · observed{" "}
                {new Date(outcome.result.observedAfter.observedAt).toISOString().replace("T", " ").slice(11, 19)}Z
                {outcome.result.verificationSource ? ` · ${outcome.result.verificationSource}` : ""}
              </p>
            ) : null}
            {!outcome.ok && outcome.result?.failureClass ? (
              <p className="mt-2 text-[11px] text-rose-300/90">
                {outcome.result.failureClass === "EXECUTION_FAILED"
                  ? "The command itself was refused — nothing was changed."
                  : outcome.result.failureClass === "VERIFICATION_TIMEOUT"
                    ? "The command was accepted, but the expected state did not appear in time. It may still be in progress — re-check before retrying."
                    : outcome.result.failureClass === "VERIFICATION_FAILED"
                      ? "The command was accepted, but the guest did not reach the expected state."
                      : "The command was accepted, but the guest could not be observed to confirm the result."}
              </p>
            ) : null}
            <p className="mt-3 text-[11px] text-slate-500">
              Reload the page to see the guest&apos;s current state.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
