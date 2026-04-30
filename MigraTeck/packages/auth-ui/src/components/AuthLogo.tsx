import { cn } from "../lib/cn";
import type { AuthBrandTheme } from "../lib/theme";

export function AuthLogo({
  theme,
  compact = false,
  className,
}: {
  theme: AuthBrandTheme;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl overflow-hidden shadow-[0_14px_36px_rgba(0,0,0,0.34)]",
          !theme.logoSrc && "bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] text-white",
          compact ? "h-11 w-11 text-sm font-black" : "h-14 w-14 text-lg font-black",
        )}
      >
        {theme.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={theme.logoSrc}
            alt={`${theme.productName} logo`}
            className="h-full w-full object-contain"
          />
        ) : (
          theme.monogram
        )}
      </div>
      <div>
        <p className={cn("font-semibold tracking-tight text-white", compact ? "text-base" : "text-xl")}>
          {theme.productName}
        </p>
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">
          {theme.securityLabel ?? "Identity & Security"}
        </p>
      </div>
    </div>
  );
}
