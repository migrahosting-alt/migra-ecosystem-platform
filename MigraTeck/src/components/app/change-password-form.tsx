"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface ChangePasswordFormProps {
  email: string | null | undefined;
}

export function ChangePasswordForm({ email }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation must match.");
      return;
    }

    setLoading(true);

    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword,
        newPassword,
        confirmPassword,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string; requiresReauth?: boolean }
      | null;

    setLoading(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to update password.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage(payload?.message || "Password updated.");

    if (payload?.requiresReauth) {
      window.setTimeout(() => {
        window.location.href = "/login?passwordChanged=1";
      }, 1200);
    }
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <h2 className="text-xl font-bold">Change password</h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Update the password for {email || "this account"}. For security, all active sessions will be ended and you will
        sign in again.
      </p>
      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Current password</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] px-3 py-2"
            autoComplete="current-password"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">New password</span>
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] px-3 py-2"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Confirm new password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] px-3 py-2"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
        <div className="flex items-center gap-3">
          <ActionButton type="submit" disabled={loading}>
            {loading ? "Updating..." : "Update password"}
          </ActionButton>
          {message ? <span className="text-sm text-green-700">{message}</span> : null}
          {error ? <span className="text-sm text-red-600">{error}</span> : null}
        </div>
      </form>
    </article>
  );
}
