"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * A refused sign-in, told to a person rather than to a debugger.
 *
 * WHAT THIS REPLACES. An invalid `/authorize` request let the schema throw, and
 * the global handler answered with raw validation JSON — field paths, expected
 * literals, our internal schema shape — rendered as a wall of text to someone
 * who had just tried to sign in. It failed closed, which was right, and it
 * looked like the product had broken, which was not.
 *
 * NOTHING IS RELAXED HERE. The request is still refused; no defaults are
 * invented and no parameter is guessed. What changes is only what the person
 * sees: a named reason they can act on, and a request id they can quote. The
 * detail behind that id stays in the server log, because a message specific
 * enough to debug with is specific enough to probe with.
 */

const REASONS: Record<string, { title: string; body: string }> = {
  invalid_request: {
    title: "That sign-in link is incomplete",
    body:
      "The request was missing information MigraAuth needs, so it was not accepted. This usually means the link was copied by hand or has been altered. Start again from the app you were signing in to.",
  },
  unknown_client: {
    title: "That application is not recognised",
    body:
      "MigraAuth has no registration for the application that sent you here, or it has been switched off. Nothing was signed in.",
  },
  invalid_redirect_uri: {
    title: "That sign-in link is not trusted",
    body:
      "The address the application asked to be returned to is not one it has registered, so MigraAuth refused rather than send you there.",
  },
  transaction_expired: {
    title: "That sign-in request expired",
    body: "Sign-in requests are short-lived for your safety. Start again from the app.",
  },
  transaction_already_used: {
    title: "That sign-in request was already completed",
    body: "Each request can be used once. If you are not signed in, start again from the app.",
  },
  transaction_unknown: {
    title: "That sign-in request is no longer valid",
    body: "Start again from the app you were signing in to.",
  },
  transaction_client_inactive: {
    title: "That application is no longer active",
    body: "Its access was switched off while you were signing in. Nothing was signed in.",
  },
};

const FALLBACK = {
  title: "Something went wrong signing you in",
  body: "The request was not accepted. Nothing was signed in. Start again from the app.",
};

function ErrorBody() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const requestId = params.get("request_id");
  const reason = REASONS[code] ?? FALLBACK;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b1020] px-6 py-16 text-white">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-7 sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h1 className="mt-5 text-[22px] leading-tight font-semibold tracking-[-0.01em]">
            {reason.title}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/60">{reason.body}</p>

          <p className="mt-6 text-sm text-white/45">
            You have not been signed in, and nothing about your account changed.
          </p>

          {requestId && (
            <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3">
              <p className="text-xs text-white/45">
                Reference for support
                <span className="mt-1 block font-mono text-[13px] break-all text-white/70">
                  {requestId}
                </span>
              </p>
            </div>
          )}

          <Link
            href="https://migrateck.com"
            className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-xl bg-white/[0.06] text-[15px] font-semibold text-white transition hover:bg-white/[0.1]"
          >
            Back to MigraTeck
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-white/35">
          Secure authentication for migrateck.com.
        </p>
      </div>
    </main>
  );
}

export default function AuthorizeErrorPage() {
  /*
   * `useSearchParams` needs a Suspense boundary. Without one the whole route
   * opts into dynamic rendering, and the page that exists to explain a failure
   * becomes slower than the failure it explains.
   */
  return (
    <Suspense fallback={null}>
      <ErrorBody />
    </Suspense>
  );
}
