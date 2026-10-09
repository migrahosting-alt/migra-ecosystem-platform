"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { panelExec, panelQuery } from "../db";
import { getSession } from "../auth";
import { createPaymentLink } from "./stripe-links";
import { loadTenantHeader } from "./tenants";
import { notifyLifecycle } from "./notifications";
import { logClientEvent } from "./audit";
import { tenantPath, tenantUrl } from "../urls";

const str = (fd: FormData, key: string) => String(fd.get(key) || "");

const buildRedirect = (params: {
  redirectTo?: string | null;
  tenantId?: string | null;
  returnTo?: string | null;
  error?: string | null;
}) => {
  const base = params.redirectTo?.trim() || "/console/billing";
  if (!params.error) return base;
  const search = new URLSearchParams();
  if (params.tenantId) search.set("tenantId", params.tenantId);
  if (params.returnTo) search.set("returnTo", params.returnTo);
  if (params.error) search.set("error", params.error);
  return `/console/billing?${search.toString()}`;
};

const revalidateBilling = (tenantId: string | null, redirectTo: string | null) => {
  revalidatePath("/console/billing");
  if (tenantId) revalidatePath(tenantPath(tenantId));
  if (redirectTo?.startsWith("/console/clients/")) revalidatePath(redirectTo);
};

export async function createBillingPaymentRequest(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId").trim();
  const returnTo = str(formData, "returnTo").trim() || null;
  const redirectTo = str(formData, "redirectTo").trim() || null;
  const description = str(formData, "description").trim();
  const amount = Number(str(formData, "amount")) || 0;
  const taxRatePct = Math.max(0, Number(str(formData, "taxRatePct")) || 0);
  const sendLink = formData.get("sendLink") === "on";
  const invoiceId = str(formData, "invoiceId").trim() || null;

  if (!tenantId || !description || amount <= 0) {
    redirect(buildRedirect({
      redirectTo,
      tenantId: tenantId || null,
      returnTo,
      error: "Client, description, and positive amount are required",
    }));
  }

  const actor = (await getSession())?.email || null;
  const orderId = randomUUID();
  const taxAmount = +(amount * (taxRatePct / 100)).toFixed(2);
  const total = +(amount + taxAmount).toFixed(2);

  try {
    await panelExec(
      `INSERT INTO orders
         (id, tenantid, status, currency, subtotal, tax_rate, tax_amount, total, createdat)
       VALUES ($1, $2, 'pending', 'USD', $3, $4, $5, $6, NOW())`,
      [orderId, tenantId, amount, taxRatePct / 100, taxAmount, total],
    );
    await logClientEvent({
      tenantId,
      actorEmail: actor,
      action: sendLink ? "order.payment_link_pending" : "order.request_created",
      resource: "order",
      resourceId: orderId,
      reason: `${description} for $${total.toFixed(2)}`,
      metadata: {
        invoiceId,
        amount,
        taxRatePct,
        sendLink,
      },
    });
  } catch (err) {
    redirect(buildRedirect({
      redirectTo,
      tenantId,
      returnTo,
      error: err instanceof Error ? err.message : "Could not create payment request",
    }));
  }

  if (sendLink) {
    try {
      const link = await createPaymentLink({
        productName: description,
        amountCents: Math.round(total * 100),
        currency: "usd",
        metadata: {
          tenantId,
          orderId,
          invoiceId: invoiceId || "",
          description,
          source: "billing-console",
        },
        successUrl: tenantUrl(tenantId),
      });
      if (link) {
        await panelExec(
          `UPDATE orders SET payment_link_url = $2, payment_link_id = $3 WHERE id = $1`,
          [orderId, link.url, link.id],
        );

        const tenant = await loadTenantHeader(tenantId);
        await notifyLifecycle({
          tenantId,
          tenantName: tenant?.name || tenantId,
          action: "order.payment_link_sent",
          actorEmail: actor,
          reason: `Assisted payment request for ${description} — $${total.toFixed(2)}: ${link.url}`,
          url: tenantUrl(tenantId),
        });
      }
    } catch (err) {
      redirect(buildRedirect({
        redirectTo,
        tenantId,
        returnTo,
        error: `Payment request created, but Stripe link failed: ${err instanceof Error ? err.message : "stripe_error"}`,
      }));
    }
  }

  revalidateBilling(tenantId, redirectTo);
  redirect(redirectTo || (tenantId ? `/console/billing?tenantId=${encodeURIComponent(tenantId)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}` : "/console/billing"));
}

export async function recordProcessedPayment(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId").trim();
  const invoiceId = str(formData, "invoiceId").trim() || null;
  const provider = str(formData, "provider").trim() || "manual";
  const providerRef = str(formData, "providerRef").trim() || null;
  const amount = Number(str(formData, "amount")) || 0;
  const status = str(formData, "status").trim() || "captured";
  const returnTo = str(formData, "returnTo").trim() || null;
  const redirectTo = str(formData, "redirectTo").trim() || null;

  if (!tenantId || amount <= 0) {
    redirect(buildRedirect({
      redirectTo,
      tenantId: tenantId || null,
      returnTo,
      error: "Client and payment amount are required",
    }));
  }

  try {
    await panelExec(
      `INSERT INTO payments
         (id, tenantid, invoiceid, provider, providerref, status, amount, createdat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [randomUUID(), tenantId, invoiceId, provider, providerRef, status, amount],
    );
    await logClientEvent({
      tenantId,
      actorEmail: (await getSession())?.email || null,
      action: "payment.recorded",
      resource: "payment",
      resourceId: invoiceId || null,
      reason: `${provider} ${status} for $${amount.toFixed(2)}`,
      metadata: {
        invoiceId,
        provider,
        providerRef,
        status,
        amount,
      },
    });

    if (invoiceId && ["paid", "captured", "succeeded"].includes(status.toLowerCase())) {
      const invoiceRows = await panelQuery<{ total: string }>(
        `SELECT total::text AS total FROM invoices WHERE id = $1 LIMIT 1`,
        [invoiceId],
      );
      const invoiceTotal = Number(invoiceRows[0]?.total || "0") || 0;
      if (amount >= invoiceTotal && invoiceTotal > 0) {
        await panelExec(`UPDATE invoices SET status = 'paid' WHERE id = $1`, [invoiceId]);
      }
    }
  } catch (err) {
    redirect(buildRedirect({
      redirectTo,
      tenantId,
      returnTo,
      error: err instanceof Error ? err.message : "Could not record payment",
    }));
  }

  revalidateBilling(tenantId, redirectTo);
  redirect(redirectTo || (tenantId ? `/console/billing?tenantId=${encodeURIComponent(tenantId)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}` : "/console/billing"));
}

export async function updateInvoiceStatus(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId").trim();
  const invoiceId = str(formData, "invoiceId").trim();
  const nextStatus = str(formData, "nextStatus").trim().toLowerCase();
  const returnTo = str(formData, "returnTo").trim() || null;
  const redirectTo = str(formData, "redirectTo").trim() || null;

  const allowedStatuses = new Set(["draft", "open", "paid", "void", "past_due"]);
  if (!tenantId || !invoiceId || !allowedStatuses.has(nextStatus)) {
    redirect(buildRedirect({
      redirectTo,
      tenantId: tenantId || null,
      returnTo,
      error: "Invoice update is missing required information",
    }));
  }

  const actor = (await getSession())?.email || null;

  try {
    await panelExec(`UPDATE invoices SET status = $2 WHERE id = $1 AND tenantid = $3`, [
      invoiceId,
      nextStatus,
      tenantId,
    ]);
    await logClientEvent({
      tenantId,
      actorEmail: actor,
      action: "invoice.status_updated",
      resource: "invoice",
      resourceId: invoiceId,
      reason: `Invoice moved to ${nextStatus}`,
      metadata: { invoiceId, nextStatus },
    });
  } catch (err) {
    redirect(buildRedirect({
      redirectTo,
      tenantId,
      returnTo,
      error: err instanceof Error ? err.message : "Could not update invoice status",
    }));
  }

  revalidateBilling(tenantId, redirectTo);
  redirect(
    redirectTo ||
      (tenantId
        ? `/console/billing?tenantId=${encodeURIComponent(tenantId)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`
        : "/console/billing"),
  );
}
