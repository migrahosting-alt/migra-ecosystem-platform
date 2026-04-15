import Link from "next/link";

export function MigraHostingQuickAction({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-[24px] border border-white/10 bg-white/[0.04] p-5 transition hover:bg-white/[0.06]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-base font-semibold tracking-[-0.02em] text-white">
            {title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-white/55">{description}</p>
        </div>

        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-white/60 transition group-hover:text-white">
          Open
        </div>
      </div>
    </Link>
  );
}
