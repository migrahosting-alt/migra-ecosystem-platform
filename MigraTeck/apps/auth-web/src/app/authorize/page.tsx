"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/api";

function AuthorizeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const state = searchParams.get("state") ?? "";
  const scope = searchParams.get("scope") ?? "openid profile email";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "S256";
  const responseType = searchParams.get("response_type") ?? "code";
  const nonce = searchParams.get("nonce");

  useEffect(() => {
    if (!clientId || !redirectUri) {
      setError("Missing required parameters (client_id, redirect_uri).");
      return;
    }

    // Try to issue a code directly (SSO check)
    authFetch<{ code?: string; redirect_to?: string; error?: string }>(
      "/authorize/complete",
      {
        method: "POST",
        body: {
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          nonce: nonce ?? undefined,
        },
      },
    )
      .then((res) => {
        if (res.ok && res.data.code) {
          // Session exists, code issued — redirect back to the client
          const url = new URL(redirectUri);
          url.searchParams.set("code", res.data.code);
          if (state) url.searchParams.set("state", state);
          window.location.href = url.toString();
        } else {
          // No session — redirect to login with OAuth params
          router.replace(`/login?${searchParams.toString()}`);
        }
      })
      .catch(() => {
        // Network error — just go to login
        router.replace(`/login?${searchParams.toString()}`);
      });
  }, [clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, nonce, router, searchParams]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-md">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Authorization error</h1>
          <p className="mt-2 text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
        <p className="mt-3 text-sm text-slate-500">Authorizing…</p>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return <Suspense><AuthorizeInner /></Suspense>;
}
