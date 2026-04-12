"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage(null);

    await fetch("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setIsLoading(false);
    setMessage("If the account exists, reset instructions have been sent.");
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <ActionButton type="submit" disabled={isLoading} className="w-full">
          {isLoading ? "Sending..." : "Send reset link"}
        </ActionButton>
      </form>
      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
    </div>
  );
}
