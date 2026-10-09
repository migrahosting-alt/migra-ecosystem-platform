import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

async function createVoiceNumber(formData: FormData) {
  "use server";

  const tenantId = String(formData.get("tenantId") || "").trim();
  const areaCode = String(formData.get("areaCode") || "").trim();
  const numberType = String(formData.get("numberType") || "local");
  const provider = String(formData.get("provider") || "auto");

  if (!tenantId || !areaCode) {
    redirect(`/console/voice/new?error=${encodeURIComponent("Client and area code are required")}`);
  }
  if (!/^\d{3}$/.test(areaCode) && numberType === "local") {
    redirect(`/console/voice/new?error=${encodeURIComponent("Area code must be 3 digits")}`);
  }

  try {
    // Queue the request via provisioning_tasks; a worker calls the upstream provider
    // and then INSERTs into business_phone_numbers on success.
    const trackingId = randomUUID();
    await panelExec(
      `INSERT INTO provisioning_tasks (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt")
       VALUES ($1, $2, $3, 'voice.number.purchase', 'queued', $4, NOW())`,
      [randomUUID(), tenantId, trackingId, randomUUID()],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(`/console/voice/new?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/console/voice`);
}

export default async function NewVoiceNumberPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  const tenants = await panelQuery<{ id: string; name: string }>(
    `SELECT id, COALESCE(name, company_name, slug, id) AS name FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name ASC LIMIT 200`,
  );

  return (
    <ConsolePageShell session={session} activePath="/console/voice" title="New Voice Number">
      <FormShell
        backHref="/console/voice"
        backLabel="Back to Voice"
        title="Purchase a new phone number"
        description="Queues a number-purchase request with the upstream voice provider (Twilio / Telnyx). The number appears in the Voice module once the purchase completes."
        error={sp.error || null}
        notice="Purchase typically completes within 30 seconds. If the area code is exhausted, the worker retries adjacent area codes."
        action={createVoiceNumber}
        submitLabel="Purchase Number"
      >
        <Field
          label="Client"
          name="tenantId"
          type="select"
          required
          options={tenants.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Field
          label="Number Type"
          name="numberType"
          type="select"
          defaultValue="local"
          options={[
            { value: "local", label: "Local (US 10-digit)" },
            { value: "toll_free", label: "Toll-free (800/888/877/866/855/844/833)" },
            { value: "intl", label: "International" },
          ]}
        />
        <Field label="Area Code" name="areaCode" required placeholder="954" hint="3-digit US area code. Ignored for toll-free." />
        <Field
          label="Provider"
          name="provider"
          type="select"
          defaultValue="auto"
          options={[
            { value: "auto", label: "Auto (cheapest available)" },
            { value: "twilio", label: "Twilio" },
            { value: "telnyx", label: "Telnyx" },
            { value: "bandwidth", label: "Bandwidth" },
          ]}
        />
      </FormShell>
    </ConsolePageShell>
  );
}
