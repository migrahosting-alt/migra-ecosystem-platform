"use server";

import { revalidatePath } from "next/cache";
import { submitInternalNote } from "./compliance-note";
import { noteReasonLabel } from "./compliance-note-contract";

/**
 * Server action for adding a compliance internal note. Marked "use server" so it
 * can be passed to a client form via useActionState. Runs entirely server-side:
 * resolves the operator session, gets the per-user AnnouPale token, posts the
 * note, and revalidates the case detail on success. Returns only a serializable
 * result — never the token.
 */

export type AddNoteState = {
  ok: boolean;
  message: string;
  // monotonic stamp so the client can detect a fresh result and reset the form
  ts: number;
};

export async function addInternalNoteAction(
  _prev: AddNoteState | undefined,
  formData: FormData,
): Promise<AddNoteState> {
  const caseId = String(formData.get("caseId") ?? "");
  const note = formData.get("note");

  const result = await submitInternalNote(caseId, note);

  if (result.ok) {
    // Refresh the server-rendered detail so the new note appears (no optimistic
    // fake — success is only reported after the backend 200).
    revalidatePath(`/console/annoupale/compliance/${caseId}`);
    return { ok: true, message: "Internal note added.", ts: Date.now() };
  }

  return { ok: false, message: noteReasonLabel(result.reason), ts: Date.now() };
}
