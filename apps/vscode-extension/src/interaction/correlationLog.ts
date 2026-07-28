/**
 * MigraPilot — recent engineer-turn correlation ids.
 *
 * The Brain sends a `correlationId` on every turn's `route` frame and audits under it, but
 * nothing on the extension side kept it, so a turn's audit trail was unreachable from the
 * host that caused it. That is a gap for support as much as for verification: "quote this
 * correlation id" is only useful advice if the id is somewhere the operator can see.
 *
 * A bounded ring buffer, metadata only — ids and the declared class, never prompts, never
 * responses. Not a test seam: the interaction runner reads it, and so can any diagnostic
 * surface that needs to tie an editor action to its server-side record.
 */

export interface CorrelationEntry {
  correlationId: string;
  /** Milliseconds since epoch. Only for ordering and staleness, never for duration claims. */
  at: number;
  model?: string;
  taskClass?: string;
  workflow?: string;
}

const CAPACITY = 32;

/**
 * Backed by a process-wide slot, not a module-local array.
 *
 * The extension host may hold TWO copies of this module: the esbuild bundle inlines one, and
 * anything importing the compiled output gets another. Module-local state made the writer and
 * the reader talk past each other silently — the turn recorded its id and the reader saw an
 * empty list, which looked exactly like a turn that produced no correlation at all.
 *
 * A shared slot is the standard remedy for duplicated module instances, and it is also what
 * makes the log readable when the extension comes from a packaged VSIX while the reader does
 * not — the Level 4 case.
 */
const SLOT = Symbol.for('migrapilot.interaction.correlationLog');

/**
 * Resolved on EVERY call, never captured in a module-level binding.
 *
 * A captured binding is not enough: if two copies of this module initialize, whichever ran
 * first holds a reference to an array the other may have replaced, and the writer then
 * appends to an array nobody reads. That failure is silent and looks exactly like a turn
 * that produced no correlation at all — which is how it presented.
 */
function slot(): CorrelationEntry[] {
  const store = globalThis as unknown as Record<symbol, CorrelationEntry[] | undefined>;
  const existing = store[SLOT];
  if (existing) return existing;
  const created: CorrelationEntry[] = [];
  store[SLOT] = created;
  return created;
}

/** Record one turn. Silently ignores a missing id — an absent id is not an error here. */
export function recordCorrelation(entry: CorrelationEntry): void {
  if (!entry.correlationId) return;
  const entries = slot();
  entries.push(entry);
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY);
}

/** Most recent first. */
export function recentCorrelations(limit = CAPACITY): CorrelationEntry[] {
  return slot().slice(-limit).reverse();
}

/** The most recent id recorded strictly after `since`, or null. */
export function correlationSince(since: number): CorrelationEntry | null {
  const entries = slot();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i]!;
    if (e.at >= since) return e;
  }
  return null;
}

/** Test isolation: one trace must not read the previous trace's correlation. */
export function clearCorrelations(): void {
  slot().length = 0;
}
