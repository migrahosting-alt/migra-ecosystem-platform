"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function SupportAutoRefresh({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, router]);

  return null;
}
