/**
 * Did the user STOP this answer, or did their browser simply go away?
 *
 * 🚨 THE SERVER CANNOT TELL THESE APART BY ITSELF, AND IT WAS GUESSING.
 *
 * Pressing Stop aborts the request. Reloading the page aborts the request.
 * Closing the tab aborts the request. Losing the network aborts the request.
 * All four arrive at the stream route as `request.signal.aborted`, so treating
 * that as a user decision labelled every one of them "You stopped this answer".
 *
 * Measured on staging: a mid-stream RELOAD persisted `status: 'stopped'`, and
 * the transcript then told the user they had deliberately stopped an answer
 * they never stopped. That is a false claim about a person's intent, made to
 * their face, on a record they keep.
 *
 * Only the browser knows which happened, because only the browser saw the
 * click. So it says so: an explicit Stop DECLARES itself here first, and then
 * aborts. An abort with no declaration is an interruption, which is the honest
 * default — it claims nothing about why.
 *
 * WHAT THIS DELIBERATELY IS NOT. It is not authority over the turn and it
 * cannot invent one: a declaration only ever downgrades "interrupted" to
 * "stopped" for a turn that was already aborted with text. A forged call can
 * relabel a caller's own interrupted turn as stopped and nothing else, which is
 * why it is keyed by request id and scoped to the principal who owns it.
 *
 * IN-MEMORY, AND THAT IS A REAL LIMIT. The window is seconds and the fact is
 * disposable, so a restart mid-turn loses the declaration and the turn records
 * as interrupted — truthful, just less specific. It would need a shared store
 * to survive multiple consumer instances; there is one instance today, and
 * saying so is better than a durable table for a fact that lives for one second.
 */

/** How long a declaration stays meaningful. A turn ends long before this. */
const TTL_MS = 60_000;

/** requestId -> { owner, at }. Small, bounded, and swept on every write. */
const declared = new Map<string, { owner: string; at: number }>();

function sweep(now: number): void {
  for (const [id, entry] of declared) {
    if (now - entry.at > TTL_MS) declared.delete(id);
  }
}

/** The browser says: this turn is being stopped on purpose. */
export function declareStop(requestId: string, owner: string, now = Date.now()): void {
  if (!requestId || !owner) return;
  sweep(now);
  declared.set(requestId, { owner, at: now });
}

/**
 * Was a stop declared for this turn, by this caller?
 *
 * The owner check is what stops one caller relabelling another's turn. A
 * declaration is consumed on read: a request id names one turn, and leaving it
 * behind would let a later interruption on a reused id inherit an intent that
 * was never expressed for it.
 */
export function consumeStopDeclaration(requestId: string, owner: string, now = Date.now()): boolean {
  if (!requestId || !owner) return false;
  sweep(now);
  const entry = declared.get(requestId);
  if (!entry || entry.owner !== owner) return false;
  declared.delete(requestId);
  return true;
}

/**
 * Wait briefly for a declaration that may still be in flight.
 *
 * The browser fires the declaration and then aborts, but two requests racing
 * across a network have no guaranteed order, and the loser would be recorded as
 * an interruption the user would recognise as their own Stop. A short bounded
 * wait costs nothing on the path that matters — it runs ONLY when a turn has
 * already been aborted, never on a normal completion.
 */
export async function awaitStopDeclaration(
  requestId: string,
  owner: string,
  opts: { timeoutMs?: number; stepMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 500;
  const stepMs = opts.stepMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (consumeStopDeclaration(requestId, owner)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** Test seam: forget everything. */
export function resetStopDeclarations(): void {
  declared.clear();
}
