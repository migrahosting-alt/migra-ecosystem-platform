"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

/**
 * Sign in with a provider, when there is a provider to sign in with.
 *
 * THE BUTTONS COME FROM THE SERVER, not from a list in this file. A deployment
 * without a Google client must not render a Google button — it would lead to a
 * consent screen for an application that does not exist, which reads as "this
 * product is broken" rather than "this option is off". So the component asks
 * what is configured and renders exactly that, and renders nothing at all while
 * it does not know.
 *
 * `authorizeQuery` is the FULL query this page was reached with. Carrying it
 * whole is what makes a provider sign-in finish the OIDC flow the visitor was
 * already in the middle of, rather than starting a new one that has lost the
 * client's PKCE challenge — and therefore lost the destination, the `next`
 * path, and the anonymous conversation waiting to be claimed.
 */

interface Provider {
  id: string;
  label: string;
}

/** Marks, drawn inline so a sign-in screen never waits on a third-party asset. */
function ProviderMark({ id }: { id: string }) {
  if (id === "google") {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
        <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"
      />
    </svg>
  );
}

/**
 * The absolute authorize URL to come back to.
 *
 * BUILT FROM THE BROWSER'S OWN ORIGIN, not from `API_BASE`. In production
 * `NEXT_PUBLIC_AUTH_API_URL` is the RELATIVE `/api`, so composing the
 * destination from it yields `/api/authorize?...` — and the server's
 * `safeReturnTo` refuses relative values on purpose, because a provider
 * callback has no meaningful base to resolve them against. The sign-in would
 * have completed and then quietly landed on the default page instead of
 * finishing the OIDC flow, taking the `next` path and the anonymous
 * conversation with it.
 *
 * `/authorize` is served at this origin's root — the published
 * `authorization_endpoint` — so the origin is the correct and only base.
 */
function absoluteAuthorizeUrl(query: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/authorize${query ? `?${query}` : ""}`;
}

export function SocialSignIn({ authorizeQuery }: { authorizeQuery: string | null }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE}/v1/social/providers`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { providers?: Provider[] } | null) => {
        if (!cancelled) setProviders(payload?.providers ?? []);
      })
      .catch(() => {
        // Unreachable is not the same as unconfigured, but for this screen the
        // safe rendering is identical: offer nothing rather than a button that
        // cannot work. Email and password are unaffected either way.
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing while unknown, and nothing when none: no flash of a button that is
  // about to disappear, and no empty divider over a blank space.
  if (!providers || providers.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-white/[0.12]" />
        <span className="text-xs font-medium text-white/45">or continue with</span>
        <span className="h-px flex-1 bg-white/[0.12]" />
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {providers.map((provider) => (
          <a
            key={provider.id}
            data-testid={`social-${provider.id}`}
            href={`${API_BASE}/v1/social/${provider.id}/start?return_to=${encodeURIComponent(
              absoluteAuthorizeUrl(authorizeQuery ?? ""),
            )}`}
            className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-white/[0.12] bg-white/[0.04] text-[15px] font-semibold text-white/90 transition hover:border-white/25 hover:bg-white/[0.08]"
          >
            <ProviderMark id={provider.id} />
            Continue with {provider.label}
          </a>
        ))}
      </div>
    </div>
  );
}
