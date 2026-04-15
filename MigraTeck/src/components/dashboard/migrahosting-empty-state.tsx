import Link from "next/link";

export function MigraHostingEmptyState({
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      <h4 className="text-lg font-semibold tracking-[-0.02em] text-white">{title}</h4>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/55">
        {description}
      </p>

      {ctaLabel && ctaHref ? (
        <Link
          href={ctaHref}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#ec4899_100%)] px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.25)] transition hover:opacity-95"
        >
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
