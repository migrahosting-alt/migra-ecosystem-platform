"use client";

import { EntitlementStatus, ProductKey } from "@prisma/client";
import { useMemo, useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface EntitlementRow {
  product: ProductKey;
  status: EntitlementStatus;
  startsAt: string | null;
  endsAt: string | null;
  notes: string | null;
  updatedAt: string | null;
}

type EntitlementUpdatePayload = Omit<EntitlementRow, "updatedAt">;

interface OrgEntitlementsEditorProps {
  orgId: string;
  canEdit: boolean;
  isMigraHostingClient: boolean;
  initialRows: EntitlementRow[];
}

function toInputValue(value: string | null): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 16);
}

function fromInputValue(value: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

const statusOptions = [
  EntitlementStatus.ACTIVE,
  EntitlementStatus.TRIAL,
  EntitlementStatus.RESTRICTED,
  EntitlementStatus.INTERNAL_ONLY,
];

export function OrgEntitlementsEditor({ orgId, canEdit, isMigraHostingClient, initialRows }: OrgEntitlementsEditorProps) {
  const [rows, setRows] = useState(initialRows);
  const [savingProduct, setSavingProduct] = useState<ProductKey | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const byProduct = useMemo(() => {
    const map = new Map<ProductKey, EntitlementRow>();
    for (const row of rows) {
      map.set(row.product, row);
    }
    return map;
  }, [rows]);

  function updateRow(product: ProductKey, patch: Partial<EntitlementRow>) {
    setRows((previous) =>
      previous.map((row) =>
        row.product === product
          ? {
              ...row,
              ...patch,
            }
          : row,
      ),
    );
  }

  async function persist(payload: EntitlementUpdatePayload[] | EntitlementUpdatePayload, saveKey: ProductKey | "all") {
    setSavingProduct(saveKey);
    setError(null);
    setMessage(null);

    const updates = Array.isArray(payload) ? payload : [payload];
    const intentResponse = await fetch("/api/security/intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "org:entitlement:update",
        orgId,
        payload: updates,
        reason: reason || undefined,
        stepUp: {
          ...(password ? { password } : {}),
          ...(totpCode ? { totpCode } : {}),
        },
      }),
    });

    const intentPayload = (await intentResponse.json().catch(() => null)) as { intentId?: string } | null;
    if (!intentResponse.ok || !intentPayload?.intentId) {
      setSavingProduct(null);
      setError("Tier-2 confirmation failed.");
      return;
    }

    const response = await fetch(`/api/orgs/${orgId}/entitlements`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intentId: intentPayload.intentId,
        updates,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | { error?: string; entitlements?: EntitlementRow[] }
      | null;

    setSavingProduct(null);

    if (!response.ok) {
      setError(body?.error || "Unable to update entitlements.");
      return;
    }

    if (body?.entitlements?.length) {
      const next = new Map(rows.map((row) => [row.product, row]));
      for (const entitlement of body.entitlements) {
        next.set(entitlement.product, {
          ...entitlement,
          startsAt: entitlement.startsAt,
          endsAt: entitlement.endsAt,
          notes: entitlement.notes,
          updatedAt: entitlement.updatedAt,
        });
      }
      setRows(Array.from(next.values()));
    }

    setMessage("Entitlements saved.");
  }

  function rowPayload(row: EntitlementRow): EntitlementUpdatePayload {
    return {
      product: row.product,
      status: row.status,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      notes: row.notes,
    };
  }

  return (
    <section className="space-y-4">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-lg font-bold">Entitlements matrix</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          MigraHosting client flag: {isMigraHostingClient ? "Enabled" : "Disabled"}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Starts</th>
                <th className="px-3 py-2 text-left">Ends</th>
                <th className="px-3 py-2 text-left">Notes</th>
                <th className="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-semibold text-[var(--ink)]">{row.product}</td>
                  <td className="px-3 py-2">
                    <select
                      value={row.status}
                      disabled={!canEdit}
                      onChange={(event) => updateRow(row.product, { status: event.target.value as EntitlementStatus })}
                      className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="datetime-local"
                      disabled={!canEdit}
                      value={toInputValue(row.startsAt)}
                      onChange={(event) => updateRow(row.product, { startsAt: fromInputValue(event.target.value) })}
                      className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="datetime-local"
                      disabled={!canEdit}
                      value={toInputValue(row.endsAt)}
                      onChange={(event) => updateRow(row.product, { endsAt: fromInputValue(event.target.value) })}
                      className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={row.notes || ""}
                      onChange={(event) => updateRow(row.product, { notes: event.target.value || null })}
                      className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <ActionButton
                      variant="secondary"
                      disabled={!canEdit || savingProduct === "all" || savingProduct === row.product}
                      onClick={() => void persist(rowPayload(byProduct.get(row.product) || row), row.product)}
                    >
                      {savingProduct === row.product ? "Saving..." : "Save"}
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Change reason (Tier-2)</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Password (step-up)</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">TOTP code (step-up)</span>
              <input value={totpCode} onChange={(event) => setTotpCode(event.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1" />
            </label>
          </div>
        ) : null}
        <div className="mt-4 flex items-center gap-3">
          <ActionButton disabled={!canEdit || savingProduct !== null} onClick={() => void persist(rows.map(rowPayload), "all")}>
            {savingProduct === "all" ? "Saving..." : "Save all"}
          </ActionButton>
          {message ? <span className="text-sm text-green-700">{message}</span> : null}
          {error ? <span className="text-sm text-red-600">{error}</span> : null}
        </div>
        {!canEdit ? <p className="mt-3 text-xs text-[var(--ink-muted)]">Your role has read-only entitlement access.</p> : null}
      </article>
    </section>
  );
}
