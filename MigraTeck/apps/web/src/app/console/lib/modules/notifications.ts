/**
 * Lifecycle notifications — email + Slack.
 *
 * All notification fns are fire-and-forget. They NEVER throw — a failed
 * notification must never block the underlying mutation. Errors are logged
 * to stderr.
 *
 * Config (env on app-core):
 *   CONSOLE_NOTIFY_EMAIL_TO=ops@migrateck.com,billing@migrateck.com
 *   CONSOLE_NOTIFY_SMTP_RELAY=https://mail-core.tailnet/api/relay  (optional)
 *   CONSOLE_NOTIFY_SLACK_WEBHOOK=https://hooks.slack.com/services/...
 *
 * If a channel is unconfigured, that channel is skipped silently.
 */

import { loadTenantName } from "./tenants";
import { tenantUrl } from "../urls";

type NotifyInput = {
  tenantId: string;
  tenantName?: string;     // optional — auto-looked-up if missing
  action: string;          // e.g. "tenant.suspend"
  actorEmail?: string | null;
  reason?: string | null;
  url?: string;            // link back to the client detail page (auto if missing)
};

const buildSubject = (i: NotifyInput): string => {
  const verb = i.action.split(".").pop() || i.action;
  return `[MigraTeck Console] ${verb} → ${i.tenantName}`;
};

const buildBody = (i: NotifyInput): string => {
  const lines = [
    `Action:   ${i.action}`,
    `Client:   ${i.tenantName} (${i.tenantId})`,
    `Actor:    ${i.actorEmail || "unknown"}`,
  ];
  if (i.reason) lines.push(`Reason:   ${i.reason}`);
  if (i.url) lines.push(`Link:     ${i.url}`);
  lines.push(`When:     ${new Date().toISOString()}`);
  return lines.join("\n");
};

const sendSlack = async (i: NotifyInput): Promise<void> => {
  const webhook = process.env.CONSOLE_NOTIFY_SLACK_WEBHOOK;
  if (!webhook) return;
  const text = `*${buildSubject(i)}*\n\`\`\`\n${buildBody(i)}\n\`\`\``;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[notify] slack failed", err instanceof Error ? err.message : err);
  }
};

const sendEmail = async (i: NotifyInput): Promise<void> => {
  const to = process.env.CONSOLE_NOTIFY_EMAIL_TO;
  const relay = process.env.CONSOLE_NOTIFY_SMTP_RELAY;
  if (!to || !relay) return;
  try {
    await fetch(relay, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: to.split(",").map((s) => s.trim()),
        subject: buildSubject(i),
        text: buildBody(i),
      }),
    });
  } catch (err) {
    console.error("[notify] email failed", err instanceof Error ? err.message : err);
  }
};

const NOTABLE_ACTIONS = new Set([
  "tenant.suspend",
  "tenant.cancel",
  "tenant.resume",
  "tenant.reactivate",
  "subscription.cancel",
  "order.payment_link_sent",
]);

export const notifyLifecycle = async (i: NotifyInput): Promise<void> => {
  if (!NOTABLE_ACTIONS.has(i.action)) return;

  // Resolve missing fields without making the caller do the lookup.
  const tenantName = i.tenantName || (await loadTenantName(i.tenantId));
  const url = i.url || tenantUrl(i.tenantId);
  const resolved: Required<Pick<NotifyInput, "tenantId" | "action" | "tenantName" | "url">> &
    NotifyInput = { ...i, tenantName, url };

  // Fire both in parallel — both are fire-and-forget.
  await Promise.allSettled([sendSlack(resolved), sendEmail(resolved)]);
};
