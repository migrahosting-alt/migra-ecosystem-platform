import type { ReactNode } from "react";
import { AnimatedSection } from "@/components/marketing/animated-section";
import { Chip } from "@/components/ui/chip";
import { LinkButton } from "@/components/ui/button";

type HeroAction = {
  href: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
};

type HeroStat = {
  label: string;
  value: string;
  detail?: string;
};

type MarketingPageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: HeroAction[];
  stats?: HeroStat[];
  aside?: ReactNode;
};

export function MarketingPageHero({
  eyebrow,
  title,
  description,
  actions = [],
  stats = [],
  aside,
}: MarketingPageHeroProps) {
  return (
    <section className="px-6 pb-12 pt-12 sm:pb-14 sm:pt-14">
      <AnimatedSection>
        <div className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] border border-[var(--line)] bg-white/82 p-8 shadow-[0_30px_80px_rgba(10,22,40,0.08)] backdrop-blur md:p-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(26,168,188,0.72),transparent)]" />
          <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
            <div>
              <Chip>{eyebrow}</Chip>
              <h1 className="mt-5 max-w-[12ch] font-[var(--font-space-grotesk)] text-4xl font-black tracking-[-0.06em] text-[var(--ink)] sm:text-5xl md:text-6xl">
                {title}
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[var(--ink-muted)]">{description}</p>
              {actions.length > 0 ? (
                <div className="mt-7 flex flex-wrap gap-3">
                  {actions.map((action) => (
                    <LinkButton key={`${action.href}-${action.label}`} href={action.href} variant={action.variant ?? "primary"}>
                      {action.label}
                    </LinkButton>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              {stats.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  {stats.map((stat) => (
                    <div key={stat.label} className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface-3)] px-4 py-4 shadow-[0_12px_30px_rgba(10,22,40,0.05)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ink-muted)]">{stat.label}</p>
                      <p className="mt-3 font-[var(--font-space-grotesk)] text-3xl font-black tracking-[-0.05em] text-[var(--ink)]">{stat.value}</p>
                      {stat.detail ? <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{stat.detail}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {aside ? (
                <div className="rounded-[1.75rem] border border-slate-700 bg-[radial-gradient(circle_at_top_left,rgba(26,168,188,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,197,83,0.12),transparent_24%),linear-gradient(180deg,#09111d,#122033)] p-5 text-white shadow-[0_20px_50px_rgba(10,22,40,0.2)]">
                  {aside}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </AnimatedSection>
    </section>
  );
}