"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-10 text-slate-50 antialiased">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/30 backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-300">MigraAuth</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-3 text-sm text-slate-300">
          The MigraAuth interface hit an unexpected error while rendering this screen.
        </p>
        {error.digest && (
          <p className="mt-4 rounded-xl bg-black/30 px-3 py-2 font-mono text-xs text-slate-300">
            digest: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400"
          >
            Try again
          </button>
          <a
            href="/login"
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/10"
          >
            Go to login
          </a>
        </div>
      </div>
    </div>
  );
}