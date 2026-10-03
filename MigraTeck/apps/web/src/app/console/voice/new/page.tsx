import { redirect } from "next/navigation";

import { getSession } from "../../lib/auth";
import { panelQuery } from "../../lib/db";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

/**
 * Number ordering is not connected.
 *
 * This action used to INSERT a `voice.number.purchase` row into
 * `provisioning_tasks` and then redirect to the Voice list, which reads as a
 * completed purchase. Nothing consumes that task type: a repo-wide search
 * finds this INSERT and no reader, and `provisioning_tasks` holds zero rows
 * estate-wide, so no operator has yet been misled by it.
 *
 * Refusing is the honest behaviour until ordering is wired to a provider.
 * Queueing work that never runs is worse than declining it, because the
 * operator walks away believing a number is on its way.
 */
async function createVoiceNumber(formData: FormData) {
  "use server";

  void formData;

  redirect(
    `/console/voice/new?error=${encodeURIComponent(
      "Number ordering is not connected yet. Nothing was purchased and nothing was queued. " +
        "Order the number with the provider directly, then assign it to the client from the Voice module.",
    )}`,
  );
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
        title="Add a phone number"
        description="Ordering numbers from a provider is not connected yet. Buy the number with the provider directly, then assign it to a client from the Voice module."
        error={sp.error || null}
        notice="Submitting this form does not order anything. It is kept here so the fields are ready when ordering is connected."
        action={createVoiceNumber}
        submitLabel="Add Number"
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
