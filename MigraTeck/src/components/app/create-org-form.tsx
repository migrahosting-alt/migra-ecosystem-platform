"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/button";

export function CreateOrgForm() {
  const [name, setName] = useState("");
  const [isMigraHostingClient, setIsMigraHostingClient] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/orgs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, isMigraHostingClient }),
    });

    const payload = (await response.json()) as { error?: string };

    setLoading(false);

    if (!response.ok) {
      setError(payload.error || "Failed to create organization.");
      return;
    }

    setName("");
    setIsMigraHostingClient(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
      <h3 className="text-sm font-semibold text-[var(--ink)]">Create organization</h3>
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        placeholder="Organization name"
        className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
      />
      <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
        <input
          type="checkbox"
          checked={isMigraHostingClient}
          onChange={(event) => setIsMigraHostingClient(event.target.checked)}
        />
        MigraHosting client
      </label>
      <ActionButton type="submit" disabled={loading} className="w-full">
        {loading ? "Creating..." : "Create"}
      </ActionButton>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
