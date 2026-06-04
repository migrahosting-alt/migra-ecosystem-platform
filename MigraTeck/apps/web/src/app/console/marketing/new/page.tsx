import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { getSession } from "../../lib/auth";
import { panelExec, panelQuery } from "../../lib/db";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { FormShell, Field } from "../../components/FormShell";

export const dynamic = "force-dynamic";

async function createCampaign(formData: FormData) {
  "use server";

  const tenantId = String(formData.get("tenantId") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const campaignType = String(formData.get("campaignType") || "gbp_post");
  const listingId = String(formData.get("listingId") || "").trim();
  const postType = String(formData.get("postType") || "STANDARD");

  if (!tenantId || !title) {
    redirect(`/console/marketing/new?error=${encodeURIComponent("Client and title are required")}`);
  }
  if (campaignType === "gbp_post" && !listingId) {
    redirect(`/console/marketing/new?error=${encodeURIComponent("GBP listing is required for a GBP post")}`);
  }

  const id = randomUUID();
  try {
    if (campaignType === "gbp_post") {
      await panelExec(
        `INSERT INTO gbp_posts (id, tenantid, listingid, posttype, title, summary, status, createdat)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', NOW())`,
        [id, tenantId, listingId, postType, title, body || null],
      );
    } else {
      // Other campaign types queue a provisioning task for the marketing worker
      await panelExec(
        `INSERT INTO provisioning_tasks (id, "tenantId", "serviceInstanceId", type, status, "idempotencyKey", "createdAt")
         VALUES ($1, $2, $3, 'marketing.campaign.launch', 'queued', $4, NOW())`,
        [randomUUID(), tenantId, id, randomUUID()],
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create_failed";
    redirect(`/console/marketing/new?error=${encodeURIComponent(msg)}`);
  }

  redirect(`/console/marketing`);
}

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");
  const sp = await searchParams;

  const [tenants, listings] = await Promise.all([
    panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(name, company_name, slug, id) AS name FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY name ASC LIMIT 200`,
    ),
    panelQuery<{ id: string; name: string }>(
      `SELECT id, COALESCE(businessname, googlelocationid, id) AS name FROM gbp_provision_requests WHERE status NOT IN ('draft','rejected') ORDER BY businessname ASC LIMIT 200`,
    ),
  ]);

  return (
    <ConsolePageShell session={session} activePath="/console/marketing" title="New Campaign">
      <FormShell
        backHref="/console/marketing"
        backLabel="Back to Marketing"
        title="Start a new marketing campaign"
        description="GBP posts are saved as drafts; an admin must publish to go live on Google Business Profile."
        error={sp.error || null}
        action={createCampaign}
        submitLabel="Save Draft"
      >
        <Field
          label="Client"
          name="tenantId"
          type="select"
          required
          options={tenants.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Field
          label="Campaign Type"
          name="campaignType"
          type="select"
          defaultValue="gbp_post"
          options={[
            { value: "gbp_post", label: "Google Business Profile Post" },
            { value: "email_blast", label: "Email Blast (queued)" },
            { value: "sms_blast", label: "SMS Blast (queued)" },
            { value: "social_ad", label: "Social Media Ad (queued)" },
          ]}
        />
        <Field
          label="GBP Listing"
          name="listingId"
          type="select"
          options={[{ value: "", label: "(none — not a GBP post)" }, ...listings.map((l) => ({ value: l.id, label: l.name }))]}
          hint="Required for GBP Post campaign type."
        />
        <Field
          label="Post Type"
          name="postType"
          type="select"
          defaultValue="STANDARD"
          options={[
            { value: "STANDARD", label: "Standard Update" },
            { value: "OFFER", label: "Offer / Promotion" },
            { value: "EVENT", label: "Event" },
            { value: "ALERT", label: "Alert / Announcement" },
          ]}
        />
        <Field label="Title" name="title" required placeholder="Spring Promo — 20% off" />
        <Field label="Body" name="body" type="textarea" placeholder="Campaign copy / post content" />
      </FormShell>
    </ConsolePageShell>
  );
}
