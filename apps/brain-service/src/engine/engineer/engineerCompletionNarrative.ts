/**
 * What the Brain says about a run that finished.
 *
 * A completed run used to close with "Brain completed the inspect/plan phase;
 * workspace mutation remains approval-gated" whatever it had done. On a read-only
 * inspection that describes a gate nothing was ever queued at, and it reads as
 * though a change is sitting somewhere awaiting review. It was one half of the
 * defect that made an INSPECT task render as an approval card in the client — the
 * client stopped drawing the controls, and this is the sentence that remained.
 *
 * The discriminator is the OPERATIONS, deliberately the same one the client card
 * uses. Stage is the Brain's narrative of where it got to and can say
 * `awaiting_approval` while carrying nothing; operations are the thing a person
 * would actually be approving. Keying both surfaces on the same fact means they
 * cannot drift into disagreeing about whether a change exists.
 */

export interface CompletionNarrativeTask {
  readonly proposal?: {
    readonly operations?: readonly unknown[];
  };
}

/** Whether this run produced a change a person could approve. */
export function hasMutationProposal(
  task: CompletionNarrativeTask | undefined,
): boolean {
  const operations = task?.proposal?.operations;
  return Array.isArray(operations) && operations.length > 0;
}

export const MUTATION_COMPLETION_CHECKPOINT =
  'Brain completed the inspect/plan phase; workspace mutation remains approval-gated.';

export const READ_ONLY_COMPLETION_CHECKPOINT =
  'Brain completed the read-only inspection phase.';

/**
 * The checkpoint line for a completed run.
 *
 * A proposal that exists but carries no operations is NOT actionable — a
 * withdrawn or empty changeset must not leave mutation wording behind it.
 */
export function completionCheckpointText(
  task: CompletionNarrativeTask | undefined,
): string {
  return hasMutationProposal(task)
    ? MUTATION_COMPLETION_CHECKPOINT
    : READ_ONLY_COMPLETION_CHECKPOINT;
}
