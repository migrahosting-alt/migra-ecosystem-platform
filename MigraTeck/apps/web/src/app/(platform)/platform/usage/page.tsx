import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  Activity,
  ArrowRight,
  Gauge,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { ApiUsageWorkspace } from "./ApiUsageWorkspace";

export const dynamic = "force-dynamic";

export default async function ApiUsagePage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Developers / API observability"
        title="API & Usage"
        description="Operate MigraTeck machine access from request evidence: credential attribution, success rate, latency, route behavior, rate limits, and quota state."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/platform/developers/api-keys"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <KeyRound size={14} /> API keys
            </Link>
            <Link
              href="/platform/commerce/usage"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Billable usage <ArrowRight size={14} />
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Activity size={19} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Credential-attributed traffic</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            API-key requests are measured by key, route, status, and latency so operators can see which machine credential generated the traffic.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Sanitized evidence</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Telemetry records route patterns and request IDs—not raw API secrets or query strings that may contain sensitive values.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Gauge size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Operational limits</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Per-key throttling is shown separately from commercial usage quotas so rate control and billing remain distinct responsibilities.
          </p>
        </article>
      </div>

      <ApiUsageWorkspace />
    </div>
  );
}
