"use client";

import { useState } from "react";
import type { ContactFormProps } from "@/lib/builder/types";

export function ContactFormSection({ props, siteSlug, sectionId }: {
  props: ContactFormProps;
  siteSlug?: string;
  sectionId?: string;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const payload: Record<string, string> = {};
    formData.forEach((val, key) => { payload[key] = String(val); });

    if (siteSlug && sectionId) {
      try {
        const res = await fetch(`/api/public/sites/${siteSlug}/forms/${sectionId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) setSubmitted(true);
      } catch { /* noop */ }
    } else {
      setSubmitted(true);
    }

    setSubmitting(false);
  }

  if (submitted) {
    return (
      <section className="px-6 py-20 bg-white">
        <div className="mx-auto max-w-xl text-center">
          <div className="mb-4 text-4xl">✓</div>
          <p className="text-lg text-gray-700">{props.successMessage}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-20 bg-white">
      <div className="mx-auto max-w-xl">
        <h2 className="mb-2 text-center text-3xl font-bold text-gray-900">{props.heading}</h2>
        {props.subtitle && <p className="mb-8 text-center text-gray-600">{props.subtitle}</p>}
        <form onSubmit={handleSubmit} className="space-y-5">
          {props.fields.map((field) => (
            <div key={field.name}>
              <label className="mb-1 block text-sm font-medium text-gray-700">{field.label}</label>
              {field.type === "textarea" ? (
                <textarea
                  name={field.name}
                  required={field.required}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              ) : field.type === "select" ? (
                <select
                  name={field.name}
                  required={field.required}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select...</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  name={field.name}
                  required={field.required}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              )}
            </div>
          ))}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
          >
            {submitting ? "Sending..." : props.submitLabel}
          </button>
        </form>
      </div>
    </section>
  );
}
