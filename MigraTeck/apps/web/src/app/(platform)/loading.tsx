export default function PlatformLoading() {
  return (
    <div className="p-6 lg:p-8">
      <div className="animate-pulse">
        <div className="h-3 w-28 rounded-full bg-slate-200" />
        <div className="mt-3 h-10 w-72 rounded-2xl bg-slate-200" />
        <div className="mt-3 h-5 w-full max-w-2xl rounded-full bg-slate-100" />
        <div className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-36 rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <div className="h-72 rounded-2xl border border-slate-200 bg-white" />
          <div className="h-72 rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    </div>
  );
}
