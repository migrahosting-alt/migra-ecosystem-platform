import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getAccountLinks } from "@/lib/account-links";
import { getAccessToken } from "@/lib/auth/api";

/**
 * The denial page a customer actually sees.
 *
 * Two different situations reach this route and they need different words and
 * different actions. Someone who is not signed in needs a way in; someone who IS
 * signed in but lacks entitlement is not helped by a "Sign in" button, because
 * signing in again changes nothing.
 *
 * The copy deliberately names no internal system. "Protected by MigraAuth-derived
 * product permissions" told the reader which service we run, not what to do next.
 *
 * There is no "Request access" action because there is no request-access
 * workflow: /request-access currently redirects to /products. A button that
 * looks like a request and quietly does nothing is worse than its absence.
 */
export default async function UnauthorizedPage() {
  const accountLinks = getAccountLinks();
  const signedIn = (await getAccessToken()) !== null;

  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
          Access denied
        </p>

        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
          {signedIn ? "You don’t have access to this area" : "You don’t have permission to open this page"}
        </h1>

        <p className="mt-3 text-sm text-slate-600">
          {signedIn
            ? "Your account is signed in, but it doesn’t have permission for this product or workspace. If you think it should, contact the person who manages your organization’s access."
            : "Sign in with an account that has access, or return to the public site."}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {signedIn ? (
            <>
              <Link
                href="/platform/overview"
                className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Open platform
              </Link>
              <Link
                href="/"
                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              >
                Return to public site
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href={accountLinks.login}
                className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Sign in
              </Link>
              <Link
                href="/"
                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              >
                Return to MigraTeck
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
