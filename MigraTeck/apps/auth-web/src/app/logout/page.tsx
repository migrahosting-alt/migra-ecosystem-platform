"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/api";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    authFetch("/v1/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        router.replace("/login");
      });
  }, [router]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
      <p className="text-sm text-slate-500">Signing out…</p>
    </div>
  );
}
