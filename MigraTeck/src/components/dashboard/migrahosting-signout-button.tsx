"use client";

import { useRouter } from "next/navigation";
import { clearAccessToken } from "@/lib/auth/client-token";

export function MigraHostingSignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        clearAccessToken();
        const response = await fetch("/api/auth/logout", {
          method: "POST",
        }).catch(() => null);

        const payload = response
          ? (await response.json().catch(() => null)) as { redirectTo?: string } | null
          : null;

        if (payload?.redirectTo) {
          window.location.href = payload.redirectTo;
          return;
        }

        router.push("/login");
        router.refresh();
      }}
      className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white/75 transition hover:bg-white/[0.06] hover:text-white"
    >
      Sign out
    </button>
  );
}
