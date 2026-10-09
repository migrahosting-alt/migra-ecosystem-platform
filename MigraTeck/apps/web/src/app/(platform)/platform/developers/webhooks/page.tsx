import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { AlertTriangle, ArrowLeft, ShieldCheck, Webhook } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Developers / Event delivery"
        title="Webhooks & Events"
        description="The developer webhook contract is defined, but its runtime is not registered in production. This page reports that boundary instead of exposing controls that cannot execute."
        actions={
          <Link
            href="/platform/developers"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Developer platform
          </Link>
        }
      />

      <section className="rounded-3xl border border-amber-200 bg-[linear-gradient(135deg,#fffbeb,#ffffff)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              <AlertTriangle size={14} />
              Runtime not registered
            </div>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">
              Developer webhook operations are disabled in production.
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Endpoint creation, event delivery, signing-secret rotation, test
              events, manual replay, and delivery-history operations are not
              exposed until the Platform API routes and delivery runtime are
              deliberately registered and accepted end to end.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-amber-800">
            No webhook mutations are sent from this page.
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Webhook size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Contract defined
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Signed HTTPS endpoint, event subscription, retry, replay, and
            secret-rotation contracts remain available in source for a
            controlled future activation.
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Fail closed
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            MigraTeck does not claim endpoints, deliveries, retries, or signing
            secrets are live while their owning backend runtime is absent.
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <AlertTriangle size={19} className="text-amber-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Activation gate
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Activation requires registered Platform API routes, the delivery
            worker, outbound-network enforcement, signing-key lifecycle,
            retry/replay evidence, authorization, audit, and production
            acceptance.
          </p>
        </article>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          Available developer capabilities
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          API Keys, OAuth Applications, and API & Usage remain active. Use the
          Developer Platform page to operate those registered capabilities.
        </p>
      </section>
    </div>
  );
}
