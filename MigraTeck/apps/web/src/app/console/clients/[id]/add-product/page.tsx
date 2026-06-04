import { redirect, notFound } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../../lib/auth";
import { panelExec, panelQuery, isPanelDbConfigured } from "../../../lib/db";
import { ConsolePageShell } from "../../../components/ConsolePageShell";
import { FormShell, Field } from "../../../components/FormShell";
import { logClientEvent } from "../../../lib/modules/audit";
import { createPaymentLink } from "../../../lib/modules/stripe-links";
import { notifyLifecycle } from "../../../lib/modules/notifications";
import { enqueueProvisioningTask } from "../../../lib/modules/provisioning";
import { redirectWithError } from "../../../lib/modules/redirect-helpers";
import { loadTenantHeader } from "../../../lib/modules/tenants";
import { tenantPath, tenantUrl, addProductPath } from "../../../lib/urls";

export const dynamic = "force-dynamic";

type ProductRow = {
  id: string;
  name: string;
  price: number | null;
  type: string | null;
  category: string | null;
};

const DEFAULT_TAX_RATE = (() => {
  const raw = process.env.CONSOLE_DEFAULT_TAX_RATE || "0";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : 0;
})();

const loadProducts = async (): Promise<ProductRow[]> => {
  if (!isPanelDbConfigured()) return [];
  const rows = await panelQuery<{
    id: string;
    name: string;
    price: string | null;
    type: string | null;
    category: string | null;
  }>(
    `SELECT id,
            COALESCE(name, id) AS name,
            price::text AS price,
            type,
            category
       FROM products
      WHERE COALESCE(status, 'active') IN ('active','published')
        AND (type IS NULL OR type NOT IN ('addon'))
      ORDER BY name ASC
      LIMIT 300`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    price: r.price == null ? null : Number(r.price),
    type: r.type,
    category: r.category,
  }));
};

async function addProduct(formData: FormData) {
  "use server";

  const tenantId = String(formData.get("tenantId") || "");
  const productId = String(formData.get("productId") || "");
  const qty = Math.max(1, Number(String(formData.get("qty") || "1")) || 1);
  const unitPriceOverride = String(formData.get("unitPrice") || "").trim();
  const taxRatePct = Number(String(formData.get("taxRatePct") || "0")) || 0;
  const sendLink = formData.get("sendLink") === "on";

  if (!tenantId) redirect("/console/clients");
  if (!productId) redirectWithError(addProductPath(tenantId), "Pick a product");

  const actor = (await getSession())?.email || null;

  const catalog = await panelQuery<{ name: string | null; price: string | null }>(
    `SELECT name, price::text AS price FROM products WHERE id = $1`,
    [productId],
  );
  if (catalog.length === 0) redirectWithError(addProductPath(tenantId), "Product not found");

  const productName = catalog[0]!.name || "Product";
  const catalogPrice = Number(catalog[0]!.price || "0") || 0;
  const unitPrice = unitPriceOverride === "" ? catalogPrice : Number(unitPriceOverride) || 0;
  const subtotal = unitPrice * qty;
  const taxAmount = +(subtotal * (taxRatePct / 100)).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);

  const orderId = randomUUID();
  try {
    await panelExec(
      `INSERT INTO orders
         (id, tenantid, status, currency, subtotal, tax_rate, tax_amount, total, createdat, updated_at)
       VALUES ($1, $2, 'pending', 'USD', $3, $4, $5, $6, NOW(), NOW())`,
      [orderId, tenantId, subtotal, taxRatePct / 100, taxAmount, total],
    );
    await panelExec(
      `INSERT INTO order_items
         (id, orderid, productid, qty, unitprice, total, createdat)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [randomUUID(), orderId, productId, qty, unitPrice, subtotal],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "insert_failed";
    await logClientEvent({
      tenantId, actorEmail: actor, action: "order.add",
      resource: "order", resourceId: orderId, result: "failure", error: msg,
    });
    redirectWithError(addProductPath(tenantId), msg);
  }

  await logClientEvent({
    tenantId, actorEmail: actor, action: "order.add",
    resource: "order", resourceId: orderId,
    metadata: { productId, productName, qty, unitPrice, taxRatePct, total },
  });

  await enqueueProvisioningTask({
    tenantId,
    type: "order.fulfill",
    payload: { orderId, productId, qty },
  });

  if (sendLink) {
    try {
      const link = await createPaymentLink({
        productName: `${productName} (x${qty})`,
        amountCents: Math.round(total * 100),
        currency: "usd",
        metadata: { tenantId, orderId, productId },
        successUrl: tenantUrl(tenantId),
      });
      if (link) {
        await panelExec(
          `UPDATE orders SET payment_link_url = $2, payment_link_id = $3, updated_at = NOW() WHERE id = $1`,
          [orderId, link.url, link.id],
        ).catch((e) => console.error("[addProduct] could not persist payment link", e));

        await logClientEvent({
          tenantId, actorEmail: actor, action: "order.payment_link_sent",
          resource: "order", resourceId: orderId,
          metadata: { paymentLinkUrl: link.url, paymentLinkId: link.id, total },
        });

        const header = await loadTenantHeader(tenantId);
        await notifyLifecycle({
          tenantId,
          tenantName: header?.name || tenantId,
          action: "order.payment_link_sent",
          actorEmail: actor,
          reason: `Payment link for ${productName} (x${qty}) — $${total.toFixed(2)}: ${link.url}`,
          url: tenantUrl(tenantId),
        });

        redirect(`${tenantPath(tenantId)}?paymentLink=${encodeURIComponent(link.url)}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "stripe_failed";
      await logClientEvent({
        tenantId, actorEmail: actor, action: "order.payment_link_sent",
        resource: "order", resourceId: orderId, result: "failure", error: msg,
      });
      redirectWithError(tenantPath(tenantId), `Order created; payment link failed: ${msg}`);
    }
  }

  redirect(tenantPath(tenantId));
}

export default async function AddProductPage({
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
  const [tenant, products] = await Promise.all([loadTenantHeader(id), loadProducts()]);
  if (!tenant) notFound();

  const productOptions = [
    { value: "", label: products.length === 0 ? "— No products found —" : "— Select a product —" },
    ...products.map((p) => ({
      value: p.id,
      label: `${p.name}${p.category ? ` [${p.category}]` : ""}${p.price != null ? ` — $${p.price.toFixed(2)}` : ""}`,
    })),
  ];

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/clients"
      title={`Add product to ${tenant.name}`}
    >
      <FormShell
        backHref={tenantPath(id)}
        backLabel={`Back to ${tenant.name}`}
        title="Add one-time product"
        description="Creates an order for a one-time charge. Optionally generates a Stripe payment link."
        error={sp.error || null}
        action={addProduct}
        submitLabel="Add product"
      >
        <input type="hidden" name="tenantId" value={id} />
        <Field
          label="Product"
          name="productId"
          type="select"
          required
          options={productOptions}
        />
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
          hint="Optional. Leave blank to bill the product's catalog price."
        />
        <Field
          label="Tax rate (%)"
          name="taxRatePct"
          type="number"
          defaultValue={String((DEFAULT_TAX_RATE * 100).toFixed(2))}
          placeholder="0.00"
          hint="Sales tax rate as a percentage. Defaults to CONSOLE_DEFAULT_TAX_RATE env. 0 = no tax."
        />
        <div>
          <label className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-300">
            <input type="checkbox" name="sendLink" defaultChecked className="rounded border-white/20 bg-white/5" />
            Generate Stripe payment link
          </label>
          <p className="text-[10px] text-slate-500">
            If checked, creates a Stripe payment link for this order and stores it on the order record.
            Requires STRIPE_SECRET_KEY in the console env.
          </p>
        </div>
      </FormShell>
    </ConsolePageShell>
  );
}
