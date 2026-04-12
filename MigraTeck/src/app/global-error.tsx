"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-white">
        <div className="mx-auto max-w-md px-6 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Something went wrong</h1>
          <p className="mt-4 text-sm text-neutral-400">
            An unexpected error occurred. If the problem persists, contact{" "}
            <a href="mailto:support@migrateck.com" className="underline">
              support@migrateck.com
            </a>
            .
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-8 rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
