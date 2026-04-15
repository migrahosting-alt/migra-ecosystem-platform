import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export function Input({
  label,
  hint,
  error,
  leftSlot,
  rightSlot,
  wrapperClassName,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  wrapperClassName?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("space-y-2", wrapperClassName)}>
      {label ? (
        <label htmlFor={id} className="block text-sm font-medium text-zinc-100">
          {label}
        </label>
      ) : null}
      <div
        className={cn(
          "auth-input-shell flex h-11 items-center overflow-hidden rounded-2xl border border-white/10 bg-black/20 px-4 text-sm transition focus-within:border-[var(--brand-accent)] focus-within:ring-2 focus-within:ring-[rgb(var(--ring)/0.25)]",
          error ? "border-rose-400/45" : "",
        )}
      >
        {leftSlot ? <div className="mr-2 shrink-0 text-zinc-400">{leftSlot}</div> : null}
        <input
          id={id}
          aria-describedby={describedBy}
          className={cn(
            "h-full min-w-0 w-full rounded-[inherit] bg-transparent text-zinc-50 outline-none placeholder:text-zinc-500",
            className,
          )}
          {...props}
        />
        {rightSlot ? <div className="ml-2 shrink-0">{rightSlot}</div> : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-rose-300">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
