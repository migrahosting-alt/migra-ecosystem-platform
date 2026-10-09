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

import { getSession } from "../auth";
import { withAuditedAction } from "./action-runner";
import { enqueueProvisioningTask } from "./provisioning";
import { revalidatePath } from "next/cache";

const sitePath = (id: string) => `/console/hosting/${id}`;
const str = (fd: FormData, key: string): string => String(fd.get(key) || "");
const getActor = async () => (await getSession())?.email || null;



/**
 * SUSPEND / RESUME ARE REFUSED — they executed, but never enforced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `pauseSite` ran `UPDATE websites SET status = 'suspended'` and nothing else.
 * The record said suspended; the customer's site kept serving. An operator
 * suspending a non-paying account had no way to know that.
 *
 * Real enforcement does exist. The edge keeps `/etc/migrapanel/tenant-suspended.map`,
 * and a matching entry makes nginx `return 503` while deliberately leaving
 * `/.well-known/acme-challenge/` reachable so certificates keep renewing. The
 * toggle script itself is sound — idempotent, `nginx -t` before reload, reverts
 * on failure.
 *
 * It could not honestly be wired yet:
 *
 *   · setEdgeSuspension returns ok:true for an EMPTY domain list — success for
 *     zero work, the same shape as the defect removed in the previous release
 *   · the enforcement snippet is included by 16 of 65 edge vhosts, so only 3 of
 *     7 real customer sites can be suspended at all
 *   · the platform models 33 domains while the edge answers on 85 distinct
 *     server_names — the control cannot enumerate a site's serving surface
 *
 * A control that cannot list every hostname it must silence cannot prove it
 * suspended anything. Both actions refuse rather than write a status column that
 * means nothing, until the hostname model and edge coverage are reconciled.
 *
 * No write is performed, existing customer state is untouched, and this module
 * neither reads nor modifies the edge map.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/* Not exported: this is a "use server" module, and Next allows only async
   function exports from one. */
const SUSPENSION_UNAVAILABLE =
  "Suspending and resuming a site are unavailable from the Control Center until edge enforcement covers every hostname the site answers on. Nothing was changed.";

/** Refuses before any write. Direct invocation must not succeed merely because the control was removed. */
export async function pauseSite(_formData: FormData): Promise<void> {
  console.warn("[hosting] refused suspend — edge enforcement is not provable");
  throw new Error(SUSPENSION_UNAVAILABLE);
}

/** Refuses before any write, for the same reason as pauseSite. */
export async function resumeSite(_formData: FormData): Promise<void> {
  console.warn("[hosting] refused resume — edge enforcement is not provable");
  throw new Error(SUSPENSION_UNAVAILABLE);
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
