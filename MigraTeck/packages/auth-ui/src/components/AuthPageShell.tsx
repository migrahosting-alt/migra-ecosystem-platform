import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { AuthBrandTheme } from "../lib/theme";
import { toBrandStyle } from "../lib/theme";
import { AuthLogo } from "./AuthLogo";
import { Badge } from "./Badge";

export function AuthPageShell({
  theme,
  contextLabel,
  title,
  subtitle,
  trustBullets,
  children,
  auxiliary,
}: {
  theme: AuthBrandTheme;
  contextLabel?: string | null;
  title: string;
  subtitle: string;
  trustBullets?: string[];
  children: ReactNode;
  auxiliary?: ReactNode;
}) {
  const bullets = trustBullets ?? theme.trustBullets ?? [];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.22),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(236,72,153,0.16),transparent_28%),linear-gradient(180deg,#090b12_0%,#0f1118_48%,#090b12_100%)] px-4 py-6 text-white md:px-6 md:py-8" style={toBrandStyle(theme)}>
      <div className="mx-auto flex w-full max-w-6xl justify-start lg:justify-end">
        <div className="rounded-full border border-white/10 bg-white/5 p-1.5 backdrop-blur-md">
          {auxiliary}
        </div>
      </div>
      <div className="mx-auto mt-5 flex min-h-[calc(100vh-7rem)] w-full max-w-6xl items-center">
        <div className="grid w-full gap-5 lg:grid-cols-[minmax(0,1.1fr)_28rem] lg:items-center xl:grid-cols-[minmax(0,1.15fr)_30rem]">
          <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-7 shadow-[0_25px_80px_rgba(0,0,0,0.4)] backdrop-blur-xl md:p-8 lg:min-h-[34rem] lg:p-10">
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.8),transparent)]" />
          <div className="absolute -left-24 top-[-3rem] h-60 w-60 rounded-full bg-[radial-gradient(circle,var(--brand-start),transparent_65%)] opacity-20 blur-3xl" />
          <div className="absolute bottom-[-5rem] right-[-2rem] h-72 w-72 rounded-full bg-[radial-gradient(circle,var(--brand-end),transparent_65%)] opacity-15 blur-3xl" />

          <div className="relative">
            <AuthLogo theme={theme} />
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <Badge tone="primary">{theme.eyebrow ?? "Secure access"}</Badge>
              {contextLabel ? <Badge tone="info">{contextLabel}</Badge> : null}
            </div>
            <h1 className={cn("mt-6 max-w-xl text-3xl font-semibold tracking-tight text-white md:text-4xl xl:text-5xl")}>
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-300 md:text-base">{subtitle}</p>

            <div className="mt-8 grid max-w-xl gap-3">
              {bullets.map((bullet) => (
                <div
                  key={bullet}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-200"
                >
                  {bullet}
                </div>
              ))}
            </div>

            {theme.supportCopy ? (
              <p className="mt-8 max-w-xl text-sm leading-6 text-zinc-400">{theme.supportCopy}</p>
            ) : null}
          </div>
          </section>

          <section className="mx-auto w-full max-w-[30rem] lg:mx-0">{children}</section>
        </div>
      </div>
    </div>
  );
}
