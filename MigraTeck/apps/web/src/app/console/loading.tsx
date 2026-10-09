export default function ConsoleLoading() {
  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <aside className="hidden w-64 shrink-0 border-r border-white/5 bg-slate-950/95 lg:block" />
      <main className="flex-1 p-6 lg:p-8">
        <div className="space-y-4 animate-pulse">
          <div className="h-16 rounded-2xl border border-white/10 bg-white/[0.03]" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 rounded-2xl border border-white/10 bg-white/[0.03]" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="h-[34rem] rounded-2xl border border-white/10 bg-white/[0.03] lg:col-span-2" />
            <div className="h-[34rem] rounded-2xl border border-white/10 bg-white/[0.03]" />
          </div>
        </div>
      </main>
    </div>
  );
}
