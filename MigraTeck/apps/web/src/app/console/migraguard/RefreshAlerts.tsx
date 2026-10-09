"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshAlerts() {
  const router = useRouter();
  const [pending,startTransition] = useTransition();
  return <button type="button" aria-label="Refresh alerts" title="Refresh alerts" disabled={pending}
    onClick={()=>startTransition(()=>router.refresh())}
    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 disabled:opacity-50">
    <RefreshCw size={16} className={pending ? "animate-spin" : undefined} />
  </button>;
}
