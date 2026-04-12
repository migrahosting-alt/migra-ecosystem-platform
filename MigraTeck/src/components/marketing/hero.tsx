"use client";

import { motion } from "framer-motion";
import { LinkButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import Link from "next/link";

const stats = [
  { label: "Identity and governance", value: "RBAC, policy, risk-tier enforcement" },
  { label: "Developer platform", value: "APIs, deterministic workflows, modular services" },
  { label: "Orchestration core", value: "Signed jobs, retries, worker control" },
  { label: "Distribution surface", value: "Entitlements, downloads, org-scoped access" },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-12 md:pb-20 md:pt-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-[#0b1728]/16 via-[#0b1728]/6 to-transparent" />
        <div className="absolute -left-24 -top-20 h-96 w-96 rounded-full bg-[color:var(--brand-100)] blur-3xl" />
        <div className="absolute right-0 top-10 h-80 w-80 rounded-full bg-[color:var(--accent-100)] blur-3xl" />
      </div>
      <div className="relative mx-auto w-full max-w-7xl rounded-[2rem] border border-[var(--line)] bg-white/82 p-8 shadow-[0_30px_80px_rgba(10,22,40,0.08)] backdrop-blur md:p-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(26,168,188,0.72),transparent)]" />

        <div className="grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-center">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-6"
        >
          <Chip>Enterprise Control Plane</Chip>
          <h1 className="max-w-[11ch] text-balance font-[var(--font-space-grotesk)] text-4xl font-black tracking-[-0.06em] text-[var(--ink)] md:text-7xl">
            The enterprise surface for products, access, and launch control.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-[var(--ink-muted)]">
            MigraTeck brings centralized identity, multi-tenant governance, entitlement intelligence, pricing, and deterministic provisioning into one sharper front door.
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/products">Browse Products</LinkButton>
            <LinkButton href="/platform" variant="secondary">
              Explore Architecture
            </LinkButton>
          </div>
          <Link
            href="/developers"
            className="inline-flex text-sm font-semibold text-[var(--brand-700)] transition-colors hover:text-[var(--brand-600)]"
          >
            View developer surface →
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[1.75rem] border border-slate-700 bg-[radial-gradient(circle_at_top_left,rgba(26,168,188,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,197,83,0.12),transparent_24%),linear-gradient(180deg,#09111d,#122033)] p-6 text-white shadow-[0_20px_60px_-38px_rgba(13,27,42,0.45)]"
        >
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Platform Depth</p>
          <div className="space-y-4">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.16 + index * 0.08 }}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{stat.label}</p>
                <p className="mt-1 text-base font-semibold text-white">{stat.value}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
        </div>
      </div>
    </section>
  );
}
