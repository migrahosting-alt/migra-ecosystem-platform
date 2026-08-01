// MigraPilot — the one approved way to dispatch child work from a chat turn.
//
// Every site in CHAT_DISPATCH_SITES with `requiresChild: true` must go through
// `governedChild`. The structural guard enforces that by removing every
// `governedChild(...)` region from the source and asserting none of those callees
// survive in the remainder — so a direct call cannot hide behind a similar-looking
// wrapper.
//
// Ordering, which is the entire contract:
//
//   1  create + persist the child record in `created`
//   2  persist the child id into the parent turn
//   3  confirm the parent revision was written  ← dispatch is REFUSED if this fails
//   4  transition the child to `running`
//   5  dispatch the actual work
//   6  persist child terminal evidence
//
// Step 3 is the reason the order is what it is. Work that the parent cannot durably
// account for is worse than work not done: on restart, nothing would say it was sent.

import type { ChatTurnExecution } from './chatTurnExecution.js';
import { siteById, type DispatchClass } from './chatDispatchRegistry.js';

/**
 * Thrown when registration failed, so the caller cannot proceed to dispatch by
 * accident. Carries the reason for a truthful, non-generic surface.
 */
export class ChildDispatchRefused extends Error {
  constructor(
    readonly siteId: string,
    readonly childId: string,
    readonly reason: string,
  ) {
    super(`dispatch refused for ${siteId}: ${reason}`);
    this.name = 'ChildDispatchRefused';
  }
}

let childCounter = 0;

/** Distinct per site so ids remain legible in a record dump. */
export function nextChildId(siteId: string): string {
  childCounter += 1;
  return `${siteId}-${Date.now().toString(36)}-${childCounter}`;
}

/** The child's execution class, preserved rather than flattened to "tool" — it decides
 * how cancellation, retry and diagnostics should treat the record later. */
export function classOf(siteId: string): DispatchClass {
  return siteById(siteId)?.classification ?? 'passive_local';
}

/**
 * Run `work` as a governed child of `turn`.
 *
 * With no turn (no store wired) the work runs directly and UNGOVERNED. That is honest:
 * inventing a parent so the call site looks governed would be the same class of lie
 * this whole slice removes.
 */
export async function governedChild<T>(
  turn: ChatTurnExecution | undefined,
  siteId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!turn) return work();

  const site = siteById(siteId);
  const childId = nextChildId(siteId);
  const requestedAction = `${classOf(siteId)}:${siteId}`;

  // 1 + 2 + 3 — existence, reference, and confirmation that the reference is durable.
  const registration = await turn.registerChild(childId, requestedAction);
  if (registration.decision !== 'dispatch') {
    // The child is already marked orphaned_before_dispatch by registerChild. Nothing
    // was sent, and `finish()` will refuse to report success.
    throw new ChildDispatchRefused(siteId, childId, registration.reason);
  }

  // 4 — only now may the child be considered live.
  await turn.startChild(childId);

  // 5 — dispatch.
  try {
    const value = await work();
    // 6 — terminal evidence, persisted before the caller continues.
    await turn.finishChild(childId, 'success');
    turn.noteChildTerminal(childId, 'success');
    return value;
  } catch (err) {
    // A cancellation is recorded as a cancellation, not as a failure: the difference
    // decides whether the parent may report `cancelled` at all.
    const cancelled = isCancellation(err);
    await turn.finishChild(childId, cancelled ? 'cancelled' : 'failure', summarise(err));
    turn.noteChildTerminal(childId, cancelled ? 'cancelled' : 'failure');
    throw err;
  }
}

function isCancellation(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  const code = (err as { code?: string } | undefined)?.code;
  return name === 'AbortError' || name === 'Canceled' || code === 'ABORT_ERR';
}

/** Non-sensitive summary. Bodies, payloads and tokens never reach a record. */
function summarise(err: unknown): string {
  const name = (err as { name?: string } | undefined)?.name ?? 'Error';
  const message = err instanceof Error ? err.message : String(err);
  return `${name}: ${message.slice(0, 200)}`;
}

/**
 * `site.requiresChild === false` sites still go through a named call, so a reader can
 * see the decision at the call site instead of inferring it from absence.
 */
export function passiveLocal<T>(_siteId: string, work: () => T): T {
  return work();
}
