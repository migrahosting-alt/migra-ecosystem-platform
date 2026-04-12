"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, type FormEvent } from "react";
import { authFetch } from "@/lib/api";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">(
    token ? "verifying" : "idle",
  );
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) return;

    authFetch<{ message?: string; error?: string }>("/v1/verify-email", {
      method: "POST",
      body: { token },
    }).then((res) => {
      if (res.ok) {
        setStatus("success");
        setMessage("Your email has been verified. You can now sign in.");
      } else {
        setStatus("error");
        setMessage(res.data.message ?? "Verification failed or link expired.");
      }
    }).catch(() => {
      setStatus("error");
      setMessage("Network error. Please try again.");
    });
  }, [token]);

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setResending(true);

    try {
      await authFetch("/v1/resend-verification", {
        method: "POST",
        body: { email },
      });
      setMessage("A new verification email has been sent.");
    } catch {
      setMessage("Could not resend. Please try again later.");
    } finally {
      setResending(false);
    }
  }

  // Waiting for user to check their email
  if (!token) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl">
          ✉️
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-500">
          We sent a verification link to{" "}
          {email ? <strong className="text-slate-700">{email}</strong> : "your inbox"}.
        </p>
        <p className="mt-1 text-sm text-slate-500">Click the link to activate your account.</p>

        {email && (
          <form onSubmit={handleResend} className="mt-6">
            {message && (
              <p className="mb-3 text-sm text-blue-600">{message}</p>
            )}
            <button
              type="submit"
              disabled={resending}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
            >
              {resending ? "Sending…" : "Resend verification email"}
            </button>
          </form>
        )}
      </div>
    );
  }

  // Token present — verify
  if (status === "verifying") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <h1 className="text-xl font-semibold text-slate-900">Verifying…</h1>
        <p className="mt-2 text-sm text-slate-500">Please wait while we verify your email.</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl">
          ✓
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Email verified</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <a
          href="/login"
          className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
        ✗
      </div>
      <h1 className="text-xl font-semibold text-slate-900">Verification failed</h1>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <a
        href="/signup"
        className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
      >
        Sign up again
      </a>
    </div>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><VerifyEmailInner /></Suspense>;
}
