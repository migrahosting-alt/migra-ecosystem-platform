import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession, isConfigured } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function ConsoleLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (session) {
    redirect(sp.next || "/console");
  }

  const configured = isConfigured();
  const err = sp.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="mx-auto flex max-w-[240px] flex-col items-center">
            <Image
              src="/brands/products/migrapanel-control-center.png"
              alt="MigraPanel"
              width={240}
              height={180}
              priority
              className="h-auto w-full object-contain"
            />
            <p className="mt-3 text-[10px] uppercase tracking-[0.32em] text-slate-500">Control Center</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
          <h1 className="text-lg font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-xs text-slate-400">Restricted to authorized MigraPanel administrators.</p>

          {!configured && (
            <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
              <strong className="font-semibold">Auth not configured.</strong>{" "}
              The server is missing one or more of:
              <code className="ml-1">CONSOLE_ADMIN_EMAIL</code>,
              <code className="ml-1">CONSOLE_ADMIN_PASSWORD_HASH</code>,
              <code className="ml-1">CONSOLE_SESSION_SECRET</code>.
            </div>
          )}

          {err && (
            <div className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-[11px] text-rose-200">
              {err === "invalid"
                ? "Incorrect email or password."
                : err === "noconfig"
                  ? "Auth env vars missing on the server."
                  : "Could not sign in. Try again."}
            </div>
          )}

          <form action="/console/api/login" method="POST" className="mt-5 space-y-4">
            <div>
              <label htmlFor="email" className="block text-[11px] font-medium text-slate-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
                placeholder="admin@migrateck.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-[11px] font-medium text-slate-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
              />
            </div>
            {sp.next && <input type="hidden" name="next" value={sp.next} />}
            <button
              type="submit"
              className="w-full rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition hover:shadow-fuchsia-500/50"
            >
              Sign in
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[10px] text-slate-600">
          MigraPanel Control Center · Sessions expire after 12 hours.
        </p>
      </div>
    </div>
  );
}
