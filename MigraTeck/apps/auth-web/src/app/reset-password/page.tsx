"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/api";
import Link from "next/link";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-slate-900">Invalid link</h1>
        <p className="mt-2 text-sm text-slate-500">This password reset link is invalid or has expired.</p>
        <Link
          href="/forgot-password"
          className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const res = await authFetch<{ message?: string }>("/v1/reset-password", {
        method: "POST",
        body: { token, password },
      });

      if (!res.ok) {
        setError(res.data.message ?? "Reset failed. The link may have expired.");
        setLoading(false);
        return;
      }

      setDone(true);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl">
          ✓
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Password updated</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your password has been reset. All other sessions have been signed out.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Set new password</h1>
      <p className="mt-1 text-sm text-slate-500">Choose a strong password for your account.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Min 8 characters"
          />
        </div>

        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="Repeat password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Updating…" : "Reset password"}
        </button>
      </form>
    </div>
  );
}
export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}