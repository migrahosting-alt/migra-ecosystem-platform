import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h2 className="text-6xl font-bold tracking-tighter">404</h2>
        <p className="mt-4 text-lg font-medium">Page not found</p>
        <p className="mt-2 text-sm text-neutral-400">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
