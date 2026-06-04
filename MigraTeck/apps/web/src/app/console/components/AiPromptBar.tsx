"use client";

import { useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export const AiPromptBar = () => {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ⌥/ (Option+/) to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "/") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = (ref.current?.value ?? "").trim();
    if (!q) return;
    router.push(`/console/support?q=${encodeURIComponent(q)}`);
    if (ref.current) ref.current.value = "";
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative hidden min-w-[280px] max-w-md flex-1 lg:block"
    >
      <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fuchsia-300" />
      <input
        ref={ref}
        type="text"
        placeholder="Ask AI to monitor, create, automate, or investigate..."
        className="w-full rounded-full border border-fuchsia-400/20 bg-gradient-to-r from-fuchsia-500/10 via-purple-500/10 to-pink-500/10 py-2 pl-10 pr-12 text-sm text-slate-200 placeholder:text-slate-400 focus:border-fuchsia-400/50 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-fuchsia-400/20 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-200">
        ⌥/
      </kbd>
    </form>
  );
};
