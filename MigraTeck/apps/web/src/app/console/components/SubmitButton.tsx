"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

type Tone = "default" | "ok" | "warn" | "bad" | "accent" | "ghost";

const toneClass = (t: Tone): string => {
  switch (t) {
    case "ok":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20";
    case "warn":
      return "border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20";
    case "bad":
      return "border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20";
    case "accent":
      return "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20";
    case "ghost":
      return "border-white/10 bg-transparent text-slate-300 hover:bg-white/5";
    default:
      return "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10";
  }
};

export const SubmitButton = ({
  children,
  tone = "default",
  pendingLabel,
  className = "",
  title,
  size = "md",
}: {
  children: ReactNode;
  tone?: Tone;
  pendingLabel?: ReactNode;
  className?: string;
  title?: string;
  size?: "sm" | "md";
}) => {
  const { pending } = useFormStatus();
  const sizeCls = size === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-2 text-xs";
  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass(tone)} ${sizeCls} ${className}`}
    >
      {pending ? (
        <>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
          {pendingLabel || "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
};
