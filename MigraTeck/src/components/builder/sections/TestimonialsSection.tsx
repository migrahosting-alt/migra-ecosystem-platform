"use client";

import type { TestimonialsProps } from "@/lib/builder/types";

export function TestimonialsSection({ props }: { props: TestimonialsProps }) {
  return (
    <section className="px-6 py-20 bg-gray-50">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-12 text-center text-3xl font-bold text-gray-900 sm:text-4xl">{props.heading}</h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {props.items.map((item, i) => (
            <div key={i} className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
              {item.rating && (
                <div className="mb-3 flex gap-1">
                  {Array.from({ length: item.rating }, (_, j) => (
                    <span key={j} className="text-yellow-400">★</span>
                  ))}
                </div>
              )}
              <blockquote className="mb-4 text-sm text-gray-700 leading-relaxed italic">
                &ldquo;{item.quote}&rdquo;
              </blockquote>
              <div className="flex items-center gap-3">
                {item.avatarUrl && (
                  <img src={item.avatarUrl} alt={item.author} className="h-10 w-10 rounded-full object-cover" />
                )}
                <div>
                  <div className="text-sm font-semibold text-gray-900">{item.author}</div>
                  {item.role && <div className="text-xs text-gray-500">{item.role}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
