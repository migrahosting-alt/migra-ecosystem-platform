"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "../../lib/auth";
import {
  getPaleRole,
  canSuspendAccounts,
  canBanAccounts,
  canRestoreAccounts,
} from "../../lib/pale-rbac";
import { suspendUser, banUser, restoreUser } from "../../lib/pale-admin";

export type ActionResult = { ok: boolean; error?: string };

const REASON_MAX = 500;

/** Validate a user id (uuid-ish) without leaking input. */
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-f-]{8,}$/i.test(id);

/** Required, trimmed, capped reason. Empty → rejected. */
const cleanReason = (reason: unknown): string | null => {
  if (typeof reason !== "string") return null;
  const r = reason.trim();
  if (!r) return null;
  return r.slice(0, REASON_MAX);
};

const revalidate = (id: string) => {
  revalidatePath("/console/pale/users");
  revalidatePath(`/console/pale/users/${id}`);
  revalidatePath("/console/pale");
};

export async function suspendUserAction(id: string, reason: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authenticated." };
  const role = getPaleRole(session);
  if (!canSuspendAccounts(role)) return { ok: false, error: "Your role cannot suspend accounts." };
  if (!validId(id)) return { ok: false, error: "Invalid user id." };
  const r = cleanReason(reason);
  if (!r) return { ok: false, error: "A reason is required." };

  const result = await suspendUser(id, r, session.email, role);
  if (result.ok) {
    revalidate(id);
    return { ok: true };
  }
  return { ok: false, error: result.error };
}

export async function banUserAction(id: string, reason: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authenticated." };
  const role = getPaleRole(session);
  if (!canBanAccounts(role)) return { ok: false, error: "Your role cannot ban accounts." };
  if (!validId(id)) return { ok: false, error: "Invalid user id." };
  const r = cleanReason(reason);
  if (!r) return { ok: false, error: "A reason is required." };

  const result = await banUser(id, r, session.email, role);
  if (result.ok) {
    revalidate(id);
    return { ok: true };
  }
  return { ok: false, error: result.error };
}

export async function restoreUserAction(id: string, reason: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authenticated." };
  const role = getPaleRole(session);
  if (!canRestoreAccounts(role)) return { ok: false, error: "Your role cannot restore accounts." };
  if (!validId(id)) return { ok: false, error: "Invalid user id." };
  const r = cleanReason(reason);
  if (!r) return { ok: false, error: "A reason is required." };

  const result = await restoreUser(id, r, session.email, role);
  if (result.ok) {
    revalidate(id);
    return { ok: true };
  }
  return { ok: false, error: result.error };
}
