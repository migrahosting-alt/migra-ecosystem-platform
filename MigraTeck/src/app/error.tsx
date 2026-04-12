"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Something went wrong</h2>
        <p className="mt-3 text-sm text-neutral-400">
          An unexpected error occurred. Please try again or contact{" "}
          <a href="mailto:support@migrateck.com" className="underline">
            support@migrateck.com
          </a>
          .
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
