"use client";

import { useMemo, useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface JobRow {
  id: string;
  type: string;
  status: string;
  attempts: number;
  lastError: string | null;
}

interface OpsJobActionsProps {
  orgId: string;
  jobs: JobRow[];
}

async function createIntent(input: {
  action: string;
  orgId: string;
  payload: Record<string, unknown>;
  reason?: string | undefined;
  password?: string | undefined;
  totpCode?: string | undefined;
}) {
  const response = await fetch("/api/security/intents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: input.action,
      orgId: input.orgId,
      payload: input.payload,
      reason: input.reason,
      stepUp: {
        ...(input.password ? { password: input.password } : {}),
        ...(input.totpCode ? { totpCode: input.totpCode } : {}),
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Intent creation failed");
  }

  const data = (await response.json()) as { intentId?: string };
  if (!data.intentId) {
    throw new Error("Intent creation failed");
  }

  return data.intentId;
}

export function OpsJobActions({ orgId, jobs }: OpsJobActionsProps) {
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retryableJobs = useMemo(() => jobs.filter((job) => job.status === "DEAD" || job.status === "FAILED" || job.status === "CANCELED"), [jobs]);
  const cancelableJobs = useMemo(() => jobs.filter((job) => job.status === "PENDING" || job.status === "RUNNING"), [jobs]);

  async function performTier2JobAction(input: { jobId: string; operation: "retry" | "cancel" }) {
    setBusyJobId(input.jobId);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        jobId: input.jobId,
        operation: input.operation,
        reason: reason || null,
      };

      const action = input.operation === "retry" ? "ops:job:retry" : "ops:job:cancel";
      const endpoint = input.operation === "retry" ? `/api/platform/ops/jobs/${input.jobId}/retry` : `/api/platform/ops/jobs/${input.jobId}/cancel`;

      const intentId = await createIntent({
        action,
        orgId,
        payload,
        reason: reason || undefined,
        password: password || undefined,
        totpCode: totpCode || undefined,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intentId,
          reason: reason || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Operation failed");
      }

      setMessage(`Job ${input.operation} requested.`);
      window.location.reload();
    } catch {
      setError("Tier-2 operation failed.");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
      <h2 className="text-lg font-bold">Dead-letter controls</h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">Retry or cancel jobs through Tier-2 intent confirmation.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Reason</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Password (step-up)</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">TOTP code (step-up)</span>
          <input value={totpCode} onChange={(event) => setTotpCode(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Retryable jobs</h3>
          <div className="mt-2 space-y-2">
            {retryableJobs.length === 0 ? <p className="text-xs text-[var(--ink-muted)]">No retryable jobs.</p> : null}
            {retryableJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2 text-xs">
                <div>
                  <p className="font-semibold">{job.id}</p>
                  <p className="text-[var(--ink-muted)]">{job.type} · {job.status} · attempts {job.attempts}</p>
                </div>
                <ActionButton disabled={busyJobId === job.id} onClick={() => performTier2JobAction({ jobId: job.id, operation: "retry" })}>
                  Retry
                </ActionButton>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Cancelable jobs</h3>
          <div className="mt-2 space-y-2">
            {cancelableJobs.length === 0 ? <p className="text-xs text-[var(--ink-muted)]">No cancelable jobs.</p> : null}
            {cancelableJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2 text-xs">
                <div>
                  <p className="font-semibold">{job.id}</p>
                  <p className="text-[var(--ink-muted)]">{job.type} · {job.status} · attempts {job.attempts}</p>
                </div>
                <ActionButton disabled={busyJobId === job.id} onClick={() => performTier2JobAction({ jobId: job.id, operation: "cancel" })}>
                  Cancel
                </ActionButton>
              </div>
            ))}
          </div>
        </div>
      </div>

      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </article>
  );
}
