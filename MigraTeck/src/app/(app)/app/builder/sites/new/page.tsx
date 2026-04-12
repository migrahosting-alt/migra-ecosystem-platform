"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewSitePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [siteName, setSiteName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/builder/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), siteName: siteName.trim() || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? "Generation failed.");
        return;
      }

      router.push(`/app/builder/sites/${data.site.id}/editor`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-[var(--ink)] mb-2">Create a New Website</h1>
      <p className="text-[var(--ink-muted)] mb-8">
        Describe your business and we'll generate a professional website with all the key sections.
      </p>

      <form onSubmit={handleGenerate} className="space-y-6">
        <div>
          <label htmlFor="siteName" className="block text-sm font-medium text-[var(--ink)] mb-1.5">
            Website Name <span className="text-[var(--ink-muted)]">(optional)</span>
          </label>
          <input
            id="siteName"
            type="text"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="e.g., Smith Plumbing Co."
            maxLength={200}
            className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-2.5 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:border-[var(--brand-500)] focus:ring-1 focus:ring-[var(--brand-500)] outline-none transition-colors"
          />
        </div>

        <div>
          <label htmlFor="prompt" className="block text-sm font-medium text-[var(--ink)] mb-1.5">
            Describe Your Business
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="We are a plumbing company in Miami, FL. We offer residential and commercial plumbing, emergency repairs, and water heater installation. We've been in business for 15 years and pride ourselves on fast response times and fair pricing."
            rows={6}
            maxLength={2000}
            required
            className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] focus:border-[var(--brand-500)] focus:ring-1 focus:ring-[var(--brand-500)] outline-none transition-colors resize-y"
          />
          <p className="text-xs text-[var(--ink-muted)] mt-1.5">{prompt.length}/2000 characters</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-600)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-700)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Generating…" : "Generate Website"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/app/builder/sites")}
            className="rounded-lg border border-[var(--line)] px-5 py-2.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
