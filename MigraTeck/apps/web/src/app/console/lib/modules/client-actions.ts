"use server";

/**
 * All server actions for the client detail page, extracted into one module so
 * they can be imported from anywhere (the detail page, future bulk-action UI,
 * the API layer, etc).
 *
 * Every action follows the same pattern:
 *   1. Parse + validate inputs
 *   2. Resolve the actor (current session)
 *   3. Run the mutation (with try/catch when the row is critical)
 *   4. Log to client_events (success or failure)
 *   5. Send lifecycle notification if the action is notable
 *   6. revalidatePath the detail page
 *
 * Because the file is marked "use server" at the top, every exported function
 * is automatically a server action and can be passed as a form `action={...}`.
 */

import { panelExec } from "../db";
import { getSession } from "../auth";
import { enqueueProvisioningTask } from "./provisioning";
import { withAuditedAction } from "./action-runner";
import {
  createClientNote,
  deleteClientNote,
  togglePinNote,
} from "./notes";
import {
  createClientContact,
  updateClientContact,
  deleteClientContact,
  CONTACT_ROLES,
  type ContactRole,
} from "./contacts";

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────────────

const getActor = async (): Promise<string | null> => {
  const s = await getSession();
  return s?.email || null;
};

const str = (fd: FormData, key: string): string => String(fd.get(key) || "");
const trimOrNull = (fd: FormData, key: string): string | null => {
  const v = str(fd, key).trim();
  return v ? v : null;
};

const normalizeContactRole = (raw: string | null | undefined): ContactRole => {
  const v = (raw || "primary").toLowerCase();
  return (CONTACT_ROLES as readonly string[]).includes(v)
    ? (v as ContactRole)
    : "primary";
};


// ─────────────────────────────────────────────────────────────────────────────
// Tenant lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export async function activateClient(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = trimOrNull(formData, "reason");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: id, actor, action: "tenant.activate",
    resource: "tenant", resourceId: id, reason,
    run: async () => {
      await panelExec(
        `UPDATE tenants
            SET status = 'active', is_active = TRUE, deleted_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [id],
      );
    },
  });
}

export async function suspendClient(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = trimOrNull(formData, "reason");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: id, actor, action: "tenant.suspend",
    resource: "tenant", resourceId: id, reason, notify: true,
    run: async () => {
      await panelExec(
        `UPDATE tenants SET status = 'suspended', is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [id],
      );
      // Cascade to active subscriptions — failure here is non-fatal; the
      // tenant suspend already succeeded and we want the audit row.
      await panelExec(
        `UPDATE subscriptions SET status = 'paused'
          WHERE tenantid = $1 AND status IN ('active','trialing')`,
        [id],
      ).catch((e) => console.error("[suspendClient] cascade subs failed", e));
    },
  });
}

export async function cancelClient(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = trimOrNull(formData, "reason");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: id, actor, action: "tenant.cancel",
    resource: "tenant", resourceId: id, reason, notify: true,
    run: async () => {
      await panelExec(
        `UPDATE tenants
            SET status = 'churned', is_active = FALSE, deleted_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [id],
      );
      await panelExec(
        `UPDATE subscriptions SET status = 'cancelled'
          WHERE tenantid = $1 AND status IN ('active','trialing','paused')`,
        [id],
      ).catch((e) => console.error("[cancelClient] cascade subs failed", e));
    },
  });
}

export async function resumeClient(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = trimOrNull(formData, "reason");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: id, actor, action: "tenant.resume",
    resource: "tenant", resourceId: id, reason, notify: true,
    run: async () => {
      await panelExec(
        `UPDATE tenants SET status = 'active', is_active = TRUE, updated_at = NOW() WHERE id = $1`,
        [id],
      );
      await panelExec(
        `UPDATE subscriptions SET status = 'active' WHERE tenantid = $1 AND status = 'paused'`,
        [id],
      ).catch((e) => console.error("[resumeClient] cascade subs failed", e));
    },
  });
}

export async function renewClient(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = trimOrNull(formData, "reason");
  if (!id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId: id, actor, action: "tenant.renew",
    resource: "tenant", resourceId: id, reason,
    run: async () => {
      const taskId = await enqueueProvisioningTask({
        tenantId: id,
        type: "billing.renew_tenant",
      });
      if (!taskId) throw new Error("Failed to queue renewal task");
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-subscription
// ─────────────────────────────────────────────────────────────────────────────

export async function pauseSubscription(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const subId = str(formData, "subId");
  const reason = trimOrNull(formData, "reason");
  if (!tenantId || !subId) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "subscription.pause",
    resource: "subscription", resourceId: subId, reason,
    run: async () => {
      await panelExec(`UPDATE subscriptions SET status = 'paused' WHERE id = $1`, [subId]);
    },
  });
}

export async function resumeSubscription(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const subId = str(formData, "subId");
  if (!tenantId || !subId) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "subscription.resume",
    resource: "subscription", resourceId: subId,
    run: async () => {
      await panelExec(`UPDATE subscriptions SET status = 'active' WHERE id = $1`, [subId]);
    },
  });
}

export async function cancelSubscription(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const subId = str(formData, "subId");
  const reason = trimOrNull(formData, "reason");
  if (!tenantId || !subId) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "subscription.cancel",
    resource: "subscription", resourceId: subId, reason, notify: true,
    run: async () => {
      await panelExec(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [subId]);
    },
  });
}

export async function renewSubscription(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const subId = str(formData, "subId");
  if (!tenantId || !subId) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "subscription.renew",
    resource: "subscription", resourceId: subId,
    run: async () => {
      const taskId = await enqueueProvisioningTask({
        tenantId,
        serviceInstanceId: subId,
        type: "billing.renew_subscription",
      });
      if (!taskId) throw new Error("Failed to queue subscription renewal");
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────────────────

export async function addNote(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const body = str(formData, "body").trim();
  const pinned = formData.get("pinned") === "on";
  if (!tenantId || !body) return;
  const actor = await getActor();

  let noteId: string | null = null;
  await withAuditedAction({
    tenantId, actor, action: "note.add",
    resource: "note",
    metadata: { pinned, length: body.length },
    run: async () => {
      noteId = await createClientNote({ tenantId, authorEmail: actor, body, pinned });
    },
  });
  // resourceId is only known after the mutation succeeded; if we want it on
  // the success row, we'd need to log it separately. Acceptable for now —
  // the metadata + timestamp are enough to correlate.
  void noteId;
}

export async function removeNote(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const noteId = str(formData, "noteId");
  if (!tenantId || !noteId) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "note.delete",
    resource: "note", resourceId: noteId,
    run: async () => {
      await deleteClientNote(noteId);
    },
  });
}

export async function togglePinAction(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const noteId = str(formData, "noteId");
  const pinned = formData.get("pinned") === "1";
  if (!tenantId || !noteId) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: pinned ? "note.pin" : "note.unpin",
    resource: "note", resourceId: noteId,
    run: async () => {
      await togglePinNote(noteId, pinned);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Contacts
// ─────────────────────────────────────────────────────────────────────────────

export async function addContact(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  if (!tenantId) return;
  const role = normalizeContactRole(str(formData, "role"));
  const name = trimOrNull(formData, "name");
  const email = trimOrNull(formData, "email");
  const phone = trimOrNull(formData, "phone");
  const title = trimOrNull(formData, "title");
  if (!name && !email && !phone) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "contact.add",
    resource: "contact",
    metadata: { role, name, email },
    run: async () => {
      await createClientContact({ tenantId, role, name, email, phone, title });
    },
  });
}

export async function updateContact(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const id = str(formData, "id");
  if (!tenantId || !id) return;
  const role = normalizeContactRole(str(formData, "role"));
  const name = trimOrNull(formData, "name");
  const email = trimOrNull(formData, "email");
  const phone = trimOrNull(formData, "phone");
  const title = trimOrNull(formData, "title");
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "contact.update",
    resource: "contact", resourceId: id,
    run: async () => {
      await updateClientContact({ id, role, name, email, phone, title });
    },
  });
}

export async function removeContact(formData: FormData): Promise<void> {
  const tenantId = str(formData, "tenantId");
  const id = str(formData, "id");
  if (!tenantId || !id) return;
  const actor = await getActor();

  await withAuditedAction({
    tenantId, actor, action: "contact.delete",
    resource: "contact", resourceId: id,
    run: async () => {
      await deleteClientContact(id);
    },
  });
}

// Redirect helpers are sync; they live in redirect-helpers.ts so this file
// can stay marked "use server" (which forbids sync exports).
