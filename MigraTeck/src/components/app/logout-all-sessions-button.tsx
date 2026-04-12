"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/button";
import { clearAccessToken } from "@/lib/auth/client-token";

export function LogoutAllSessionsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <ActionButton
        variant="secondary"
        disabled={loading}
        onClick={async () => {
          setError(null);
          setLoading(true);

          const response = await fetch("/api/auth/logout-all", {
            method: "POST",
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            setError(payload.error || "Unable to invalidate sessions.");
            setLoading(false);
            return;
          }

          clearAccessToken();
          await fetch("/api/auth/logout", {
            method: "POST",
          }).catch(() => undefined);
          router.push("/login");
          router.refresh();
        }}
      >
        {loading ? "Ending sessions..." : "Logout all sessions"}
      </ActionButton>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
