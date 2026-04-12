"use client";

import { useState } from "react";

interface SubscribeButtonProps {
  priceId: string;
  label: string;
  highlighted?: boolean;
}

export function SubscribeButton({ priceId, label, highlighted }: SubscribeButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleCheckout() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to create checkout session.");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCheckout}
      disabled={loading}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
        highlighted
          ? "bg-[var(--brand-600)] text-white hover:bg-[var(--brand-700)]"
          : "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-2)]"
      }`}
    >
      {loading ? "Redirecting..." : label}
    </button>
  );
}

export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false);

  async function handlePortal() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to open billing portal.");
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handlePortal}
      disabled={loading}
      className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
    >
      {loading ? "Opening..." : "Manage Subscription"}
    </button>
  );
}
