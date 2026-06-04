import { redirect, notFound } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery, isPanelDbConfigured } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";
import { logClientEvent } from "../../../lib/modules/audit";
import { enqueueProvisioningTask } from "../../../lib/modules/provisioning";
import { redirectWithError } from "../../../lib/modules/redirect-helpers";
import { tenantPath, addServicePath } from "../../../lib/urls";

export const dynamic = "force-dynamic";

type PlanRow = {
  id: string;
  name: string;
  slug: string | null;
  price: number | null;
  interval: string | null;
};

const loadTenant = async (id: string) => {
  const rows = await panelQuery<{ id: string; name: string }>(
    `SELECT id, COALESCE(name, company_name, slug, id) AS name FROM tenants WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
};

const loadPlans = async (): Promise<PlanRow[]> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{
    id: string;
    name: string;
    slug: string | null;
    price: string | null;
    interval: string | null;
  }>(
    `SELECT id,
            COALESCE(name, slug, id) AS name,
            slug,
            price::text AS price,
            COALESCE(interval, billing_cycle) AS interval
       FROM plans
      WHERE COALESCE(status, 'active') IN ('active','published')
      ORDER BY COALESCE(price::numeric, 0) ASC, name ASC
      LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    price: r.price == null ? null : Number(r.price),
    interval: r.interval,
  }));
};

async function addService(formData: FormData) {
  "use server";

  const tenantId = String(formData.get("tenantId") || "");
  const planId = String(formData.get("planId") || "");
  const pricingModel = String(formData.get("pricingModel") || "").trim() || null;
  const rate = Number(String(formData.get("rate") || "0")) || 0;
  const interval = String(formData.get("interval") || "monthly");
  const startStatus = String(formData.get("status") || "active");

  if (!tenantId) redirect("/console/clients");
  if (!planId && !pricingModel) {
    redirectWithError(addServicePath(tenantId), "Pick a plan or enter a pricing label");
  }

  const subId = randomUUID();
  const label =
    pricingModel ||
    (await panelQuery<{ name: string | null; slug: string | null }>(
      `SELECT name, slug FROM plans WHERE id = $1`,
      [planId],
    ).then((rows) => rows[0]?.name || rows[0]?.slug || "service"));

  const actor = (await getSession())?.email || null;

  try {
    await panelExec(
      `INSERT INTO subscriptions
         (id, tenantid, status, pricing_model, display_name, original_rate, renewal_rate, plan_id, billing_interval, createdat, updated_at)
       VALUES ($1, $2, $3, $4, $4, $5, $5, $6, $7, NOW(), NOW())`,
      [subId, tenantId, startStatus, label, rate, planId || null, interval],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "insert_failed";
    await logClientEvent({
      tenantId, actorEmail: actor, action: "subscription.add",
      resource: "subscription", resourceId: subId, result: "failure", error: msg,
    });
    redirectWithError(addServicePath(tenantId), msg);
  }

  await logClientEvent({
    tenantId, actorEmail: actor, action: "subscription.add",
    resource: "subscription", resourceId: subId,
    metadata: { planId: planId || null, label, rate, interval, status: startStatus },
  });

  await enqueueProvisioningTask({
    tenantId,
    serviceInstanceId: subId,
    type: "subscription.activate",
  });

  redirect(tenantPath(tenantId));
}

export default async function AddServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const { id } = await params;
  const sp = await searchParams;
  const [tenant, plans] = await Promise.all([loadTenant(id), loadPlans()]);
  if (!tenant) notFound();

  const planOptions = [
    { value: "", label: plans.length === 0 ? "— No plans found —" : "— Select a plan —" },
    ...plans.map((p) => ({
      value: p.id,
      label: `${p.name}${p.price != null ? ` — $${p.price.toFixed(2)}` : ""}${p.interval ? ` / ${p.interval}` : ""}`,
    })),
  ];

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/clients"
      title={`Add service to ${tenant.name}`}
    >
      <FormShell
        backHref={tenantPath(id)}
        backLabel={`Back to ${tenant.name}`}
        title="Add subscription / service"
        description="Provisions a new recurring subscription under this client. Choose an existing plan or enter custom pricing."
        error={sp.error || null}
        action={addService}
        submitLabel="Add service"
      >
        <input type="hidden" name="tenantId" value={id} />
        <Field
          label="Plan"
          name="planId"
          type="select"
          options={planOptions}
          hint="Pick a catalog plan, or leave blank to use a custom pricing label below."
        />
        <Field
          label="Custom pricing label"
          name="pricingModel"
          placeholder="e.g. Hosting Pro Monthly"
          hint="Required only if no plan is selected. Stored on the subscription as pricing_model."
        />
        <Field
          label="Rate (USD)"
          name="rate"
          type="number"
          required
          placeholder="0.00"
          hint="Per-billing-cycle amount the client is charged."
        />
        <Field
          label="Billing interval"
          name="interval"
          type="select"
          defaultValue="monthly"
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly" },
            { value: "weekly", label: "Weekly" },
            { value: "daily", label: "Daily" },
            { value: "one-time", label: "One-time" },
          ]}
        />
        <Field
          label="Initial status"
          name="status"
          type="select"
          defaultValue="active"
          options={[
            { value: "active", label: "Active — start billing immediately" },
            { value: "trialing", label: "Trialing — free until first renewal" },
            { value: "paused", label: "Paused — created but not billed yet" },
          ]}
        />
      </FormShell>
    </ConsolePageShell>
  );
}
