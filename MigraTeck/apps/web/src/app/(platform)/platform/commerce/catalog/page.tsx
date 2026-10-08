import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  ArrowLeft,
  Boxes,
  KeyRound,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { CatalogEntitlementsWorkspace } from "./CatalogEntitlementsWorkspace";

export const dynamic = "force-dynamic";

export default async function CatalogEntitlementsPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Commerce / Product access"
        title="Catalog & Entitlements"
        description="Operate what MigraTeck sells and what organizations may actually use: canonical plans, Stripe price bindings, effective product access, and provisioning evidence."
        actions={
          <Link
            href="/platform/commerce"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Commerce overview
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Boxes size={19} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Canonical catalog</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Plans and lookup-key prices stay source-controlled so the UI cannot silently become a second pricing authority.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <KeyRound size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Stripe bindings</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Production Stripe price IDs map into product access lanes through the live binding registry.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Layers3 size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Effective access</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Organization access is read from the same OrgEntitlement rows enforced by expiry and provisioning workers.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-amber-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Provisioning-safe</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Access mutations stay locked unless they can enter the signed production provisioning pipeline.
          </p>
        </article>
      </div>

      <CatalogEntitlementsWorkspace
        consoleBaseUrl={
          process.env.MIGRAPANEL_CONSOLE_URL?.trim() || "https://migrapanel.com"
        }
        platformBaseUrl={
          process.env.APP_BASE_URL?.trim() ||
          process.env.MIGRATECK_LAUNCH_URL?.trim() ||
          "https://migrateck.com"
        }
      />
    </div>
  );
}
