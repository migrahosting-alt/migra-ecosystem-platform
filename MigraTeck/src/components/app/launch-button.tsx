"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

export function LaunchButton({ product }: { product: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <ActionButton
        disabled={loading}
        onClick={async () => {
          setError(null);
          setLoading(true);

          const response = await fetch("/api/products/launch", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ product }),
          });

          const payload = (await response.json()) as { launchUrl?: string; error?: string };
          setLoading(false);

          if (!response.ok || !payload.launchUrl) {
            setError(payload.error || "Launch unavailable.");
            return;
          }

          window.location.assign(payload.launchUrl);
        }}
      >
        {loading ? "Launching..." : "Launch"}
      </ActionButton>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
