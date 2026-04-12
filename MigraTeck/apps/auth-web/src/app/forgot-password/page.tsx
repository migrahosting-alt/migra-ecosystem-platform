"use client";

import { useState, type FormEvent } from "react";
import { authFetch } from "@/lib/api";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await authFetch<{ message?: string }>("/v1/forgot-password", {
        method: "POST",
        body: { email },
      });

      // Always show success to avoid email enumeration
      setSent(true);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl">
          ✉️
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-500">
          If an account exists for <strong className="text-slate-700">{email}</strong>, you'll
          receive a password reset link shortly.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-500">
        Enter your email and we'll send you a reset link.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="you@company.com"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
