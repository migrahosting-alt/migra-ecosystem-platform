"use client";

import { useTheme } from "../providers/ThemeProvider";
import { cn } from "../lib/cn";

const options = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1 text-xs text-zinc-300 shadow-[0_10px_35px_rgba(0,0,0,0.2)] backdrop-blur-md",
        className,
      )}
      aria-label="Theme mode"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setTheme(option.value)}
          className={cn(
            "rounded-full px-3 py-1.5 transition",
            theme === option.value
              ? "bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] text-white"
              : "text-zinc-400 hover:text-zinc-100",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
