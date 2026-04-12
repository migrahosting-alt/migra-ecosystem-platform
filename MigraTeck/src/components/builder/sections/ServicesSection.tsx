"use client";

import type { ServicesProps } from "@/lib/builder/types";

export function ServicesSection({ props }: { props: ServicesProps }) {
  return (
    <section className="px-6 py-20 bg-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">{props.heading}</h2>
          {props.subtitle && <p className="mt-4 text-lg text-gray-600">{props.subtitle}</p>}
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {props.items.map((item, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-6 transition hover:shadow-lg">
              {item.icon && <div className="mb-4 text-3xl">{item.icon}</div>}
              <h3 className="mb-2 text-lg font-semibold text-gray-900">{item.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
