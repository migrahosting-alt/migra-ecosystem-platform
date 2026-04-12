"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export function VerifyEmailCard() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [message, setMessage] = useState("Verifying email...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token) {
        setError("Verification token missing.");
        setMessage("");
        return;
      }

      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const payload = (await response.json()) as { message?: string; error?: string };

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setError(payload.error || "Verification failed.");
        setMessage("");
        return;
      }

      setMessage(payload.message || "Email verified.");
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm">
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
