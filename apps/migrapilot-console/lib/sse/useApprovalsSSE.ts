"use client";

import { useEffect, useRef } from "react";

export type ApprovalSseClientEvent = {
  type: string;
  env: string;
  approvalId: string;
  status: string;
  ts: string;
  actionKey?: string;
  runId?: string | null;
  missionId?: string | null;
  stepName?: string | null;
};

const SSE_EVENT_TYPES = [
  "approval.created",
  "approval.updated",
  "approval.executing",
  "approval.executed",
  "approval.rejected",
  "approval.expired",
] as const;

/**
 * Opens a persistent SSE connection to /api/ops/approvals/stream and calls
 * `onEvent` whenever an approval lifecycle event is pushed from the server.
 *
 * Pass `env: "all"` to receive events from every environment (no ?env= filter).
 * The EventSource is re-created only when `env` or `baseUrl` changes.
 * `onEvent` is captured via a stable ref so the caller can use an inline
 * arrow function without triggering reconnects.
 *
 * Browser auto-reconnects on drop; no manual retry logic is needed.
 */
export function useApprovalsSSE({
  env,
  baseUrl,
  onEvent,
  enabled = true,
}: {
  /** Use "all" to receive events from every environment (no env filter applied). */
  env: "dev" | "staging" | "prod" | "all";
  /** Optional if same-origin. Provide only for cross-origin deployments. */
  baseUrl?: string;
  onEvent: (evt: ApprovalSseClientEvent) => void;
  enabled?: boolean;
}) {
  /* Stable ref for the callback — prevents effect re-run when onEvent changes */
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const envParam = env !== "all" ? `?env=${encodeURIComponent(env)}` : "";
    const url = `${baseUrl ?? ""}/api/ops/approvals/stream${envParam}`;
    const es = new EventSource(url, { withCredentials: true });

    const handleEvent = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as ApprovalSseClientEvent;
        if (data?.approvalId) onEventRef.current(data);
      } catch {
        // Ignore malformed events
      }
    };

    for (const type of SSE_EVENT_TYPES) {
      es.addEventListener(type, handleEvent);
    }

    // Heartbeat/hello events — no action needed, just keeps the connection alive
    es.addEventListener("ping", () => {});
    es.addEventListener("hello", () => {});

    return () => {
      for (const type of SSE_EVENT_TYPES) {
        es.removeEventListener(type, handleEvent);
      }
      es.close();
    };
  }, [env, baseUrl, enabled]);
}
