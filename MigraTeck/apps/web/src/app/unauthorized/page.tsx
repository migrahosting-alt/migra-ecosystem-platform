export default function UnauthorizedPage() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-700">Access denied</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-950">
          You do not have permission to open this page.
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          This route is protected by MigraAuth-derived product permissions.
        </p>
      </div>
    </section>
  );
}
