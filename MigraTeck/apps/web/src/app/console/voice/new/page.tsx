import { redirect } from "next/navigation";

import { getSession } from "../../lib/auth";
import { panelQuery } from "../../lib/db";
import {
  commitNumberOrder,
  planNumberOrder,
  missingConfig,
} from "../../lib/modules/number-ordering";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";
import { SectionCard } from "../../components/SectionCard";
import { DataTable } from "../../components/DataTable";

export const dynamic = "force-dynamic";

/**
 * Search, price, and explicitly order a business phone number.
 *
 * The search is non-destructive. Purchase is a separate server action backed by
 * panel-api's short-lived plan + idempotent commit contract, so a browser retry
 * cannot silently buy the same DID twice.
 *
 * Telnyx credentials remain on panel-api and never enter the browser.
 */
const runSearch = async (formData: FormData) => {
  "use server";
  const params = new URLSearchParams();
  for (const key of ["customerId", "numberType", "areaCode", "quantity", "prefix"]) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) params.set(key, value);
  }
  if (formData.get("bestEffort")) params.set("bestEffort", "1");
  redirect(`/console/voice/new?${params.toString()}`);
};

const commitOrder = async (formData: FormData) => {
  "use server";
  const session = await getSession();
  if (!session) redirect("/console/login");

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const customerId = String(formData.get("customerId") ?? "").trim();
  const planId = String(formData.get("planId") ?? "").trim();
  const selectedNumbers = formData
    .getAll("selectedNumbers")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const chargeConfirmed = formData.get("chargeConfirmed") === "yes";

  if (!chargeConfirmed) {
    const p = new URLSearchParams({
      customerId,
      orderError: "Confirm the provider charge before submitting the order.",
    });
    redirect(`/console/voice/new?${p.toString()}`);
  }

  if (!tenantId || !customerId || !planId || selectedNumbers.length === 0) {
    const p = new URLSearchParams({ customerId, orderError: "Select the required number(s) before ordering." });
    redirect(`/console/voice/new?${p.toString()}`);
  }

  const keyMaterial = selectedNumbers.slice().sort().join(",");
  const idempotencyKey = `console:${planId}:${keyMaterial}`;

  const result = await commitNumberOrder({
    tenantId,
    customerId,
    planId,
    selectedNumbers,
    idempotencyKey,
    createdByOperatorId: session.email,
  });

  if (result.state !== "committed") {
    const p = new URLSearchParams({
      customerId,
      orderError: result.detail,
    });
    redirect(`/console/voice/new?${p.toString()}`);
  }

  const number = result.numbers.find((item) => item.ismain)?.e164 || result.numbers[0]?.e164 || "";
  const p = new URLSearchParams({
    customerId,
    orderSuccess: number || "Number order submitted",
    orderId: result.order.id,
  });
  redirect(`/console/voice/new?${p.toString()}`);
};

/**
 * Renders a provider amount as money. Telnyx returns five decimal places
 * ("1.00000"); showing that on a buy screen looks like a bug and makes two
 * prices hard to compare at a glance. A non-numeric or absent amount stays an
 * em dash, which reads as unknown rather than as zero.
 */
const money = (amount: number | null, currency: string | null) => {
  if (amount === null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const symbol = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${symbol}${n.toFixed(2)}`;
};

export default async function NewVoiceNumberPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  const customers = await panelQuery<{ id: string; tenantid: string; name: string }>(
    `SELECT c.id,
            c."tenantId" AS tenantid,
            COALESCE(NULLIF(c."displayName", ''), c."billingEmail", c."accountNumber", c.id) AS name
       FROM customers c
      ORDER BY name ASC
      LIMIT 300`,
  );

  const customerId = (sp.customerId ?? "").trim();
  const selected = customers.find((c) => c.id === customerId) ?? null;
  const numberType = sp.numberType === "toll-free" ? "toll-free" : "local";
  const areaCode = (sp.areaCode ?? "").trim();
  const quantity = Number(sp.quantity ?? "1");
  const searched = Boolean(customerId && areaCode);

  // The tenant comes from the selected customer record, never from the form.
  // A caller-supplied tenantId would let a mistyped field attribute a number
  // to the wrong company at the provider.
  const outcome = searched && selected
    ? await planNumberOrder({
        tenantId: selected.tenantid,
        customerId: selected.id,
        numberType,
        areaCode,
        quantity: Number.isFinite(quantity) ? quantity : Number.NaN,
        ...(sp.prefix ? { prefix: sp.prefix.trim() } : {}),
        ...(sp.bestEffort ? { bestEffort: true } : {}),
      })
    : null;

  const missing = missingConfig();

  return (
    <ConsolePageShell session={session} activePath="/console/voice" title="Find a Phone Number">
      <FormShell
        backHref="/console/voice"
        backLabel="Back to Voice"
        title="Search available numbers"
        description="Searches the provider live and shows the real monthly and upfront cost. Searching reserves nothing and bills nothing."
        notice="Ordering is not connected yet. This screen can price a number but cannot buy one."
        action={runSearch}
        submitLabel="Search"
      >
        <Field
          label="Customer"
          name="customerId"
          type="select"
          required
          defaultValue={customerId}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
          hint="The number would be stamped with this customer at the provider, not only in our database."
        />
        <Field
          label="Number Type"
          name="numberType"
          type="select"
          defaultValue={numberType}
          options={[
            { value: "local", label: "Local (geographic area code)" },
            { value: "toll-free", label: "Toll-free (800/833/844/855/866/877/888)" },
          ]}
        />
        <Field
          label="Area Code"
          name="areaCode"
          required
          defaultValue={areaCode}
          placeholder="954"
          hint="3 digits. For toll-free this is the 8XX prefix."
        />
        <Field
          label="How many"
          name="quantity"
          type="number"
          defaultValue={String(Number.isFinite(quantity) && quantity > 0 ? quantity : 1)}
          hint="1 to 10."
        />
        <Field
          label="Prefix (optional)"
          name="prefix"
          defaultValue={sp.prefix ?? ""}
          placeholder="501"
          hint="Digits after the area code, to favour a memorable pattern."
        />
      </FormShell>

      {missing.length > 0 && (
        <SectionCard title="Number search is not configured">
          <p className="text-[12px] leading-relaxed text-amber-300">
            This console cannot reach panel-api, so it cannot search for numbers. Missing:{" "}
            <span className="font-mono">{missing.join(", ")}</span>. Nothing below is a statement
            about what the provider has available.
          </p>
        </SectionCard>
      )}

      {sp.orderSuccess && (
        <SectionCard title="Number order submitted">
          <p className="text-[12px] leading-relaxed text-emerald-300">
            {sp.orderSuccess} is now attached to this customer and moving through phone-system activation.
          </p>
          {sp.orderId && (
            <p className="mt-2 font-mono text-[11px] text-slate-400">Order {sp.orderId}</p>
          )}
        </SectionCard>
      )}

      {sp.orderError && (
        <SectionCard title="Number order needs attention">
          <p className="text-[12px] leading-relaxed text-rose-300">{sp.orderError}</p>
        </SectionCard>
      )}

      {outcome?.state === "unavailable" && (
        <SectionCard title="The provider could not be reached">
          <p className="text-[12px] leading-relaxed text-rose-300">
            {outcome.detail}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            This is <strong>not</strong>{" "}the same as &ldquo;no numbers are available&rdquo;. The
            search did not complete, so availability in {areaCode || "this area code"} is unknown.
          </p>
        </SectionCard>
      )}

      {outcome?.state === "planned" && (
        <>
          {outcome.plan.blockers.length > 0 && (
            <SectionCard title="This order cannot proceed">
              <ul className="space-y-1 text-[12px] leading-relaxed text-rose-300">
                {outcome.plan.blockers.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            </SectionCard>
          )}

          {outcome.plan.warnings.length > 0 && (
            <SectionCard title="Worth knowing">
              <ul className="space-y-1 text-[12px] leading-relaxed text-amber-300">
                {outcome.plan.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </SectionCard>
          )}

          <SectionCard
            title={
              outcome.plan.totals
                ? `Cost if ordered — ${money(outcome.plan.totals.monthly, outcome.plan.totals.currency)}/mo + ${money(outcome.plan.totals.upfront, outcome.plan.totals.currency)} upfront`
                : "Cost if ordered — UNKNOWN"
            }
          >
            <DataTable
              columns={[
                {
                  key: "number",
                  header: "Number",
                  render: (n) => <span className="font-mono text-white">{n.display}</span>,
                },
                { key: "monthly", header: "Monthly", render: (n) => money(n.monthlyCost, n.currency) },
                { key: "upfront", header: "Upfront", render: (n) => money(n.upfrontCost, n.currency) },
                {
                  key: "e911",
                  header: "911 capable",
                  // Deliberately NOT a green "Active" pill. The provider is
                  // telling us the number CAN carry emergency service; it says
                  // nothing about whether an emergency address is registered
                  // and validated. Showing "Active" here would claim 911 works
                  // on a number that cannot dial it.
                  render: (n) => (
                    <span className={n.emergencyCapable ? "text-slate-200" : "text-amber-300"}>
                      {n.emergencyCapable ? "Capable" : "Not capable"}
                    </span>
                  ),
                },
                {
                  key: "reservable",
                  header: "Reservable",
                  render: (n) => (n.reservable ? "Yes" : "No"),
                },
              ]}
              rows={outcome.plan.candidates}
              rowKey={(n) => n.e164}
              emptyTitle="No numbers matched"
              emptyDescription="The provider answered, and had nothing matching this search."
            />
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
              At the provider these would be stamped{" "}
              <span className="font-mono">{outcome.plan.identityStamp.customerReference}</span> and
              attached to connection{" "}
              <span className="font-mono">
                {outcome.plan.identityStamp.connectionId ?? "— none configured —"}
              </span>
              .
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              <strong className="text-slate-300">911 capable</strong> means the provider can carry
              emergency service on the number. It is{" "}
              <strong className="text-slate-300">not</strong>{" "}the same as 911 being enabled: that needs a registered, validated emergency address,
              which is enrolled separately after purchase. No number on this account has one today.
            </p>
            {outcome.plan.planId && outcome.plan.blockers.length === 0 && outcome.plan.candidates.length >= (Number.isFinite(quantity) ? quantity : 1) && selected && (
              <form action={commitOrder} className="mt-5 space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                <input type="hidden" name="tenantId" value={selected.tenantid} />
                <input type="hidden" name="customerId" value={selected.id} />
                <input type="hidden" name="planId" value={outcome.plan.planId} />
                <div>
                  <label htmlFor="selectedNumbers" className="mb-2 block text-[12px] font-semibold text-slate-200">
                    Select {Number.isFinite(quantity) && quantity > 1 ? quantity + " numbers" : "the number to order"}
                  </label>
                  <select
                    id="selectedNumbers"
                    name="selectedNumbers"
                    required
                    multiple={Number.isFinite(quantity) && quantity > 1}
                    size={Number.isFinite(quantity) && quantity > 1 ? Math.min(Math.max(quantity + 2, 4), 8) : 1}
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-emerald-400/60"
                  >
                    {outcome.plan.candidates
                      .filter((candidate) => candidate.reservable)
                      .map((candidate) => (
                        <option key={candidate.e164} value={candidate.e164}>
                          {candidate.display} — {money(candidate.monthlyCost, candidate.currency)}/mo + {money(candidate.upfrontCost, candidate.currency)} upfront
                        </option>
                      ))}
                  </select>
                  {Number.isFinite(quantity) && quantity > 1 && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Select exactly {quantity} numbers. The server rejects a different count.
                    </p>
                  )}
                </div>

                <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-relaxed text-slate-300">
                  <input
                    type="checkbox"
                    name="chargeConfirmed"
                    value="yes"
                    required
                    className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-900"
                  />
                  <span>
                    I confirm this order will create a real provider number and incur the displayed
                    upfront and recurring charges. Emergency calling still requires a validated
                    emergency address after activation.
                  </span>
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] text-slate-400">
                    This quote expires {outcome.plan.expiresAt ? new Date(outcome.plan.expiresAt).toLocaleTimeString() : "soon"}.
                  </p>
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-[12px] font-bold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Create business number
                  </button>
                </div>
              </form>
            )}
          </SectionCard>
        </>
      )}
    </ConsolePageShell>
  );
}
