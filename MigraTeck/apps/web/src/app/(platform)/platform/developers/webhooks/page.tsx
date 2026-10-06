import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ArrowLeft, RefreshCw, ShieldCheck, Webhook } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { WebhookManager } from "./WebhookManager";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Developers / Event delivery"
        title="Webhooks & Events"
        description="Deliver signed MigraTeck platform events to systems your organization controls. Manage subscriptions, signing secrets, retries, delivery evidence, test events, and replay from one workspace."
        actions={
          <Link
            href="/platform/developers"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Developer platform
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Signed & encrypted</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            HMAC-SHA256 signatures protect delivery integrity. Signing secrets are encrypted at rest and shown only when issued or rotated.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <RefreshCw size={19} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Retry & replay</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Failed deliveries retry with backoff, preserve response evidence, and can be replayed manually after the receiving system recovers.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Webhook size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Outbound isolation</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            HTTPS is mandatory and delivery targets are checked against private, loopback, link-local, metadata, and reserved networks.
          </p>
        </article>
      </div>

      <WebhookManager />
    </div>
  );
}
