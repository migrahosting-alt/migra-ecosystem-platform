import { redirect } from "next/navigation";

import { getSession } from "../../lib/auth";
import { panelQuery } from "../../lib/db";
import { planNumberOrder, missingConfig } from "../../lib/modules/number-ordering";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";
import { SectionCard } from "../../components/SectionCard";
import { DataTable, StatusPill } from "../../components/DataTable";

export const dynamic = "force-dynamic";

/**
 * Search for a number and see what it would cost. This page does NOT order.
 *
 * It used to INSERT a `voice.number.purchase` row that nothing consumed and
 * then redirect as though a purchase had happened; that was removed in
 * 569062d8 and replaced with an honest refusal. This restores a useful screen
 * without restoring the lie: everything shown here is a real, live answer from
 * the provider, and the one thing that would spend money is still not wired.
 *
 * The search runs server-side through panel-api because the Telnyx key lives
 * there and deliberately does not exist in this app.
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

const money = (amount: string | null, currency: string | null) =>
  amount === null ? "—" : `${currency === "USD" || !currency ? "$" : `${currency} `}${amount}`;

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

      {outcome?.state === "unavailable" && (
        <SectionCard title="The provider could not be reached">
          <p className="text-[12px] leading-relaxed text-rose-300">
            {outcome.detail}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            This is <strong>not</strong> the same as &ldquo;no numbers are available&rdquo;. The
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
                  header: "911",
                  render: (n) => <StatusPill status={n.emergencyCapable ? "active" : "paused"} />,
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
            <p className="mt-2 text-[11px] leading-relaxed text-amber-300">
              Ordering is not wired yet. Nothing on this page buys a number — order it with the
              provider directly, then assign it from the Voice module.
            </p>
          </SectionCard>
        </>
      )}
    </ConsolePageShell>
  );
}
