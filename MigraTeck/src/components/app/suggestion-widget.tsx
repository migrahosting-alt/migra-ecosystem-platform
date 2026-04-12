"use client";

interface SuggestionItem {
  id: string;
  status: string;
  rule: {
    title: string;
    body: string;
    actionLabel: string;
    actionUrl: string | null;
    targetProduct: string;
  };
}

interface SuggestionWidgetProps {
  suggestions: SuggestionItem[];
  activeCount: number;
}

export function SuggestionWidget({ suggestions, activeCount }: SuggestionWidgetProps) {
  if (activeCount === 0) {
    return (
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-xl font-bold">Recommendations</h2>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          No active suggestions. Your ecosystem is looking good!
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Recommendations</h2>
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
          {activeCount} active
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Cross-service suggestions to grow your stack.
      </p>
      <div className="mt-4 space-y-3">
        {suggestions.map((s) => (
          <div key={s.id} className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--ink)]">{s.rule.title}</p>
              <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{s.rule.body}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                onClick={() => {
                  if (s.rule.actionUrl) window.location.href = s.rule.actionUrl;
                }}
              >
                {s.rule.actionLabel}
              </button>
              <button
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
                onClick={async () => {
                  await fetch(`/api/suggestions/${s.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "dismiss" }),
                  });
                  window.location.reload();
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
