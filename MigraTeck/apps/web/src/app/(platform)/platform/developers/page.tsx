import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { Code2, KeyRound, Boxes, Webhook, Activity, ArrowRight } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";

export const dynamic = "force-dynamic";

const capabilities = [
  {
    title: "API Keys",
    state: "Core exists",
    description: "Hashed mk_ keys, scopes, expiry, revocation, last-used tracking, and audit logging already exist in the shared platform code.",
    icon: KeyRound,
  },
  {
    title: "OAuth Applications",
    state: "Live foundation",
    description: "MigraAuth already owns OAuth clients, PKCE, scopes, redirect URIs, branding, ownership, and post-login return contracts.",
    icon: Boxes,
  },
  {
    title: "Webhooks & Events",
    state: "Contract needed",
    description: "This becomes the canonical outbound event layer: signed endpoints, subscriptions, delivery history, retries, replay, and dead-letter handling.",
    icon: Webhook,
  },
  {
    title: "API & Usage",
    state: "Metering exists",
    description: "Usage aggregation already exists in the commercial layer. Developer request visibility and rate-limit telemetry are the next integration.",
    icon: Activity,
  },
];

export default async function DeveloperPlatformPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Developer infrastructure"
        title="Developer Platform"
        description="Create and govern how software talks to MigraTeck: machine credentials, OAuth applications, event delivery, API usage, and environment boundaries."
        actions={
          <Link
            href="/platform/usage"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Review usage <ArrowRight size={15} />
          </Link>
        }
      />

      <section className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#f8fbff,#f5f3ff)] p-6 shadow-sm">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">
              <Code2 size={14} /> Platform API surface
            </div>
            <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight text-slate-950">
              One developer contract across every MigraTeck product.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Products should consume shared identity, commerce, entitlement, and event contracts instead of inventing credentials and integration rules independently.
            </p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/85 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Current operator</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{session.email}</p>
            <p className="mt-1 text-sm text-slate-500">{session.permissions.length} platform permission(s) active</p>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {capabilities.map((capability) => {
          const Icon = capability.icon;
          return (
            <article key={capability.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                    <Icon size={19} />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">{capability.title}</h3>
                    <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">{capability.state}</p>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{capability.description}</p>
            </article>
          );
        })}
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Implementation contract</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            ["Identity", "Human authentication stays in MigraAuth. Machine access uses scoped credentials owned by the developer platform."],
            ["Environment", "Sandbox, staging, and production credentials must be distinct and independently revocable."],
            ["Audit", "Credential creation, rotation, revoke, scope changes, webhook replay, and OAuth changes must be auditable."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
