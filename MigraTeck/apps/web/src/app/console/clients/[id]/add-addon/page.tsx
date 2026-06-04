import { redirect, notFound } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery, isPanelDbConfigured } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";
import { logClientEvent } from "../../../lib/modules/audit";
import { enqueueProvisioningTask } from "../../../lib/modules/provisioning";
import { redirectWithError } from "../../../lib/modules/redirect-helpers";
import { loadTenantHeader } from "../../../lib/modules/tenants";
import { SUBSCRIPTION_MUTABLE_STATUSES } from "../../../lib/modules/status";
import { tenantPath, addAddonPath } from "../../../lib/urls";

export const dynamic = "force-dynamic";

type SubRow = {
  id: string;
  label: string;
  status: string;
  startedAt: string | null;
  billingCycle: string;
};

type AddonRow = {
  id: string;
  name: string;
  price: number | null;
  billingCycle: string | null;
};

const loadSubscriptions = async (tenantId: string): Promise<SubRow[]> => {
  if (!isPanelDbConfigured()) return [];
  const statuses = SUBSCRIPTION_MUTABLE_STATUSES;
  const rows = await panelQuery<{
    id: string;
    status: string;
    pricingmodel: string | null;
    originalrate: string | null;
    createdat: string | null;
    billingcycle: string | null;
  }>(
    `SELECT id, status,
            pricing_model AS pricingmodel,
            original_rate::text AS originalrate,
            createdat::text AS createdat,
            COALESCE(billing_interval, billing_cycle, 'monthly') AS billingcycle
       FROM subscriptions
      WHERE tenantid = $1 AND status = ANY($2::text[])
      ORDER BY createdat DESC
      LIMIT 100`,
    [tenantId, `{${statuses.join(",")}}`],
  );
  return rows.map((r) => ({
    id: r.id,
    label: `${r.pricingmodel || r.id.slice(0, 8)}${r.originalrate ? ` — $${Number(r.originalrate).toFixed(2)}` : ""} [${r.status}]`,
    status: r.status,
    startedAt: r.createdat,
    billingCycle: r.billingcycle || "monthly",
  }));
};

const loadAddons = async (): Promise<AddonRow[]> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{
    id: string;
    name: string;
    price: string | null;
    billingcycle: string | null;
  }>(
    `SELECT id,
            COALESCE(name, id) AS name,
            price::text AS price,
            COALESCE(billing_cycle, 'monthly') AS billingcycle
       FROM products
      WHERE COALESCE(status, 'active') IN ('active','published')
        AND (type = 'addon' OR category = 'addon')
      ORDER BY name ASC
      LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    price: r.price == null ? null : Number(r.price),
    billingCycle: r.billingcycle,
  }));
};

/**
 * Compute prorated amount for the remainder of the current billing period.
 * Anchor is the parent subscription's createdAt.
 *
 * Exported for testability — pure function.
 */
export const computeProration = (input: {
  subscriptionStartedAt: string | null;
  billingCycle: string;
  unitPrice: number;
  qty: number;
  now?: Date;
}): {
  prorated: number;
  full: number;
  daysRemaining: number;
  periodDays: number;
  nextRenewalAt: Date;
} => {
  const now = input.now ?? new Date();
  const full = +(input.unitPrice * input.qty).toFixed(2);

  if (!input.subscriptionStartedAt) {
    return { prorated: full, full, daysRemaining: 0, periodDays: 0, nextRenewalAt: now };
  }

  const startedAt = new Date(input.subscriptionStartedAt);
  const cycle = (input.billingCycle || "monthly").toLowerCase();

  const advanceOne = (d: Date): Date => {
    const next = new Date(d);
    if (cycle === "yearly" || cycle === "annual") next.setFullYear(next.getFullYear() + 1);
    else if (cycle === "weekly") next.setDate(next.getDate() + 7);
    else if (cycle === "daily") next.setDate(next.getDate() + 1);
    else next.setMonth(next.getMonth() + 1);
    return next;
  };

  let cursor = new Date(startedAt);
  let prev = new Date(startedAt);
  let guard = 0;
  while (cursor <= now && guard < 1200) {
    prev = new Date(cursor);
    cursor = advanceOne(cursor);
    guard++;
  }
  const periodMs = cursor.getTime() - prev.getTime();
  const remainingMs = Math.max(0, cursor.getTime() - now.getTime());
  const periodDays = Math.max(1, Math.round(periodMs / 86_400_000));
  const daysRemaining = Math.max(0, Math.round(remainingMs / 86_400_000));
  const prorated = +(full * (remainingMs / periodMs)).toFixed(2);

  return { prorated, full, daysRemaining, periodDays, nextRenewalAt: cursor };
};

async function addAddon(formData: FormData) {
  "use server";

  const tenantId = String(formData.get("tenantId") || "");
  const subscriptionId = String(formData.get("subscriptionId") || "");
  const productId = String(formData.get("productId") || "");
  const qty = Math.max(1, Number(String(formData.get("qty") || "1")) || 1);
  const unitPriceOverride = String(formData.get("unitPrice") || "").trim();
  const prorate = formData.get("prorate") === "on";

  if (!tenantId) redirect("/console/clients");
  if (!subscriptionId) redirectWithError(addAddonPath(tenantId), "Pick a subscription");
  if (!productId) redirectWithError(addAddonPath(tenantId), "Pick an addon");

  const actor = (await getSession())?.email || null;

  const catalog = await panelQuery<{ price: string | null; billingcycle: string | null; name: string | null }>(
    `SELECT name, price::text AS price, COALESCE(billing_cycle, 'monthly') AS billingcycle
       FROM products WHERE id = $1`,
    [productId],
  );
  if (catalog.length === 0) redirectWithError(addAddonPath(tenantId), "Addon not found");

  const catalogPrice = Number(catalog[0]!.price || "0") || 0;
  const unitPrice = unitPriceOverride === "" ? catalogPrice : Number(unitPriceOverride) || 0;
  const billingCycle = catalog[0]!.billingcycle || "monthly";

  const subRows = await panelQuery<{ createdat: string | null; billingcycle: string | null }>(
    `SELECT createdat::text AS createdat,
            COALESCE(billing_interval, billing_cycle, 'monthly') AS billingcycle
       FROM subscriptions WHERE id = $1`,
    [subscriptionId],
  );
  const subBillingCycle = subRows[0]?.billingcycle || billingCycle;
  const proration = computeProration({
    subscriptionStartedAt: subRows[0]?.createdat || null,
    billingCycle: subBillingCycle,
    unitPrice,
    qty,
  });

  try {
    await panelExec(
      `INSERT INTO subscription_items
         (id, subscriptionid, productid, qty, unitprice, billingcycle, createdat)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [randomUUID(), subscriptionId, productId, qty, unitPrice, billingCycle],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "insert_failed";
    await logClientEvent({
      tenantId, actorEmail: actor, action: "addon.add",
      resource: "subscription_item", resourceId: subscriptionId, result: "failure", error: msg,
    });
    redirectWithError(addAddonPath(tenantId), msg);
  }

  await logClientEvent({
    tenantId, actorEmail: actor, action: "addon.add",
    resource: "subscription_item", resourceId: subscriptionId,
    metadata: {
      productId, productName: catalog[0]!.name,
      qty, unitPrice, billingCycle,
      proration: prorate
        ? {
            prorated: proration.prorated,
            full: proration.full,
            daysRemaining: proration.daysRemaining,
            periodDays: proration.periodDays,
          }
        : null,
    },
  });

  if (prorate && proration.prorated > 0 && proration.daysRemaining > 0) {
    const orderId = randomUUID();
    try {
      await panelExec(
        `INSERT INTO orders
           (id, tenantid, status, currency, subtotal, total, createdat, updated_at)
         VALUES ($1, $2, 'pending', 'USD', $3, $3, NOW(), NOW())`,
        [orderId, tenantId, proration.prorated],
      );
      await panelExec(
        `INSERT INTO order_items
           (id, orderid, productid, qty, unitprice, total, createdat)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), orderId, productId, qty, +(proration.prorated / qty).toFixed(2), proration.prorated],
      );
      await logClientEvent({
        tenantId, actorEmail: actor, action: "order.add",
        resource: "order", resourceId: orderId,
        metadata: {
          source: "addon_proration",
          subscriptionId, productId,
          proratedAmount: proration.prorated,
          fullAmount: proration.full,
          daysRemaining: proration.daysRemaining,
          periodDays: proration.periodDays,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "proration_failed";
      await logClientEvent({
        tenantId, actorEmail: actor, action: "order.add",
        resource: "order", result: "failure", error: msg,
        metadata: { source: "addon_proration", subscriptionId, productId },
      });
    }
  }

  await enqueueProvisioningTask({
    tenantId,
    serviceInstanceId: subscriptionId,
    type: "subscription.addon_added",
    payload: {
      subscriptionId, productId, qty, unitPrice,
      proration: prorate ? proration.prorated : null,
    },
  });

  redirect(tenantPath(tenantId));
}

export default async function AddAddonPage({
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
  const [tenant, subs, addons] = await Promise.all([
    loadTenantHeader(id),
    loadSubscriptions(id),
    loadAddons(),
  ]);
  if (!tenant) notFound();

  const subOptions = [
    {
      value: "",
      label:
        subs.length === 0
          ? "— No active subscriptions — add a service first —"
          : "— Select a subscription —",
    },
    ...subs.map((s) => ({ value: s.id, label: s.label })),
  ];
  const addonOptions = [
    { value: "", label: addons.length === 0 ? "— No addon products found —" : "— Select an addon —" },
    ...addons.map((a) => ({
      value: a.id,
      label: `${a.name}${a.price != null ? ` — $${a.price.toFixed(2)}` : ""}${a.billingCycle ? ` / ${a.billingCycle}` : ""}`,
    })),
  ];

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/clients"
      title={`Add addon to ${tenant.name}`}
    >
      <FormShell
        backHref={tenantPath(id)}
        backLabel={`Back to ${tenant.name}`}
        title="Add addon to subscription"
        description="Attaches an addon (extra mailboxes, storage, premium SSL, etc.) to an existing subscription. With proration enabled, a one-time charge for the partial period is queued immediately."
        error={sp.error || null}
        action={addAddon}
        submitLabel="Add addon"
      >
        <input type="hidden" name="tenantId" value={id} />
        <Field
          label="Target subscription"
          name="subscriptionId"
          type="select"
          required
          options={subOptions}
        />
        {addons.length === 0 ? (
          <Field
            label="Addon product"
            name="productId"
            type="select"
            required
            options={addonOptions}
            hint="Mark a product as type='addon' (or category='addon') in the catalog to see it here."
          />
        ) : (
          <Field
            label="Addon product"
            name="productId"
            type="select"
            required
            options={addonOptions}
          />
        )}
        <Field
          label="Quantity"
          name="qty"
          type="number"
          required
          defaultValue="1"
          placeholder="1"
        />
        <Field
          label="Unit price override (USD)"
          name="unitPrice"
          type="number"
          placeholder="(use catalog price)"
          hint="Optional. Leave blank to bill the addon's catalog price."
        />
        <div>
          <label className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-300">
            <input type="checkbox" name="prorate" defaultChecked className="rounded border-white/20 bg-white/5" />
            Charge prorated amount for the remainder of the current period
          </label>
          <p className="text-[10px] text-slate-500">
            Recommended. Computes the partial-period charge from the parent subscription's start date and billing cycle,
            then creates a one-shot order. Uncheck if the customer should only be charged starting at the next renewal.
          </p>
        </div>
      </FormShell>
    </ConsolePageShell>
  );
}
