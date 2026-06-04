"use server";

/**
 * Hosting-site server actions. Powered by the same withAuditedAction +
 * enqueueProvisioningTask helpers the client actions use, so every hosting
 * operation lands in client_events and the activity timeline.
 *
 * The site's tenantId is required when known — it lets us audit + notify
 * against the owning tenant. If the site has no tenant (rare), the audit log
 * still records the event with tenant_id='' (orphan), but no notifications
 * fire.
 */

import { panelExec } from "../db";
import { getSession } from "../auth";
import { withAuditedAction } from "./action-runner";
import { enqueueProvisioningTask } from "./provisioning";
import { revalidatePath } from "next/cache";

const sitePath = (id: string) => `/console/hosting/${id}`;
const str = (fd: FormData, key: string): string => String(fd.get(key) || "");
const getActor = async () => (await getSession())?.email || null;

export async function pauseSite(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const tenantId = str(formData, "tenantId");
  const reason = str(formData, "reason").trim() || null;
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: tenantId || id,
    actor,
    action: "hosting.suspend",
    resource: "website",
    resourceId: id,
    reason,
    revalidate: sitePath(id),
    run: async () => {
      await panelExec(
        `UPDATE websites SET status = 'suspended', "updatedAt" = NOW() WHERE id = $1`,
        [id],
      );
    },
  });
}

export async function resumeSite(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const tenantId = str(formData, "tenantId");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: tenantId || id,
    actor,
    action: "hosting.resume",
    resource: "website",
    resourceId: id,
    revalidate: sitePath(id),
    run: async () => {
      await panelExec(
        `UPDATE websites SET status = 'active', "updatedAt" = NOW() WHERE id = $1`,
        [id],
      );
    },
  });
}

export async function forceSslRenew(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const tenantId = str(formData, "tenantId");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: tenantId || id,
    actor,
    action: "hosting.ssl_renew",
    resource: "website",
    resourceId: id,
    revalidate: sitePath(id),
    run: async () => {
      const taskId = await enqueueProvisioningTask({
        tenantId: tenantId || id,
        serviceInstanceId: id,
        type: "ssl.force_renew",
      });
      if (!taskId) throw new Error("Failed to queue SSL renewal");
    },
  });
}

export async function triggerDeploy(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const tenantId = str(formData, "tenantId");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: tenantId || id,
    actor,
    action: "hosting.deploy",
    resource: "website",
    resourceId: id,
    revalidate: sitePath(id),
    run: async () => {
      const taskId = await enqueueProvisioningTask({
        tenantId: tenantId || id,
        serviceInstanceId: id,
        type: "hosting.deploy",
      });
      if (!taskId) throw new Error("Failed to queue deploy");
    },
  });
}

export async function triggerBackup(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const tenantId = str(formData, "tenantId");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: tenantId || id,
    actor,
    action: "hosting.backup",
    resource: "website",
    resourceId: id,
    revalidate: sitePath(id),
    run: async () => {
      const taskId = await enqueueProvisioningTask({
        tenantId: tenantId || id,
        serviceInstanceId: id,
        type: "hosting.backup",
      });
      if (!taskId) throw new Error("Failed to queue backup");
    },
  });

  // Belt-and-braces: explicit revalidate in case withAuditedAction's path
  // resolution misses an edge case.
  revalidatePath(sitePath(id));
}
