"use client";

import { ProductKey } from "@prisma/client";
import { useState } from "react";

interface RequestAccessButtonProps {
  orgId: string;
  product: ProductKey;
}

export function RequestAccessButton({ orgId, product }: RequestAccessButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestAccess() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/products/request-access", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orgId,
        product,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    setLoading(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to submit request.");
      return;
    }

    setMessage("Access request submitted.");
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={requestAccess}
        disabled={loading}
        className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-60"
      >
        {loading ? "Submitting..." : "Request Access"}
      </button>
      {message ? <p className="text-xs text-green-700">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
