"use server";

import { revalidatePath } from "next/cache";
import {
  submitCaseClose,
  submitCaseUpdate,
  submitStatusChange,
} from "./compliance-status";
import { statusReasonLabel } from "./compliance-status-contract";

/**
 * Server actions for compliance status / close. Marked "use server"; run
 * entirely server-side (operator session + per-user AnnouPale token), then
 * revalidate the case detail + queue on success. Return only a serializable
 * result — never the token. No optimistic/fake success.
 */

export type CaseActionState = {
  ok: boolean;
  message: string;
  ts: number;
};

function refresh(caseId: string): void {
  revalidatePath(`/console/annoupale/compliance/${caseId}`);
  revalidatePath("/console/annoupale/compliance");
}

export async function updateCaseStatusAction(
  _prev: CaseActionState | undefined,
  formData: FormData,
): Promise<CaseActionState> {
  const caseId = String(formData.get("caseId") ?? "");
  const status = formData.get("status");

  const result = await submitStatusChange(caseId, status);
  if (result.ok) {
    refresh(caseId);
    return { ok: true, message: `Status updated to “${String(status)}”.`, ts: Date.now() };
  }
  return { ok: false, message: statusReasonLabel(result.reason), ts: Date.now() };
}

/** Combined triage save: status and/or priority in one PATCH ("Save Changes"). */
export async function updateCaseAction(
  _prev: CaseActionState | undefined,
  formData: FormData,
): Promise<CaseActionState> {
  const caseId = String(formData.get("caseId") ?? "");
  const statusRaw = formData.get("status");
  const priorityRaw = formData.get("priority");
  // Empty select value = "leave unchanged".
  const status = statusRaw && String(statusRaw) !== "" ? statusRaw : undefined;
  const priority = priorityRaw && String(priorityRaw) !== "" ? priorityRaw : undefined;

  if (status === undefined && priority === undefined) {
    return { ok: false, message: "Choose a status or priority to change.", ts: Date.now() };
  }

  const result = await submitCaseUpdate(caseId, { status, priority });
  if (result.ok) {
    refresh(caseId);
    const parts: string[] = [];
    if (status) parts.push(`status → ${String(status)}`);
    if (priority) parts.push(`priority → ${String(priority)}`);
    return { ok: true, message: `Saved (${parts.join(", ")}).`, ts: Date.now() };
  }
  return { ok: false, message: statusReasonLabel(result.reason), ts: Date.now() };
}

export async function closeCaseAction(
  _prev: CaseActionState | undefined,
  formData: FormData,
): Promise<CaseActionState> {
  const caseId = String(formData.get("caseId") ?? "");
  const resolution = formData.get("resolution");
  const confirmed = formData.get("confirm") === "on";

  const result = await submitCaseClose(caseId, resolution, confirmed);
  if (result.ok) {
    refresh(caseId);
    return { ok: true, message: "Case closed. Resolution recorded.", ts: Date.now() };
  }
  return { ok: false, message: statusReasonLabel(result.reason), ts: Date.now() };
}
