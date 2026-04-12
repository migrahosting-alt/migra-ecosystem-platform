"use client";

import { Suspense, type ReactNode } from "react";

function Fallback() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
      <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      <p className="mt-3 text-sm text-slate-500">Loading…</p>
    </div>
  );
}

export function SearchParamsBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Fallback />}>{children}</Suspense>;
}
