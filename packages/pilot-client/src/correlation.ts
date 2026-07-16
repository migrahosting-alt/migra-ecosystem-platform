import { randomUUID } from 'node:crypto';

// Request/action/run correlation (see docs/pilot-api-integration-plan.md §4).
// requestId is minted extension-side per user-initiated operation and sent as
// X-Request-Id on every backend call (both backends). It also doubles as the
// idempotency key for mutating pilot-api actions so a network retry never
// double-executes.

export const REQUEST_ID_HEADER = 'X-Request-Id';

export function newRequestId(): string {
  return randomUUID();
}

/**
 * Tracks actionIds currently in-flight so approve/reject/resume/execute retries
 * are guarded client-side even if the server's idempotency support is unproven
 * (capabilities.idempotency.supported === false). Call `begin` before a mutating
 * call and `end` in a finally block.
 */
export class InFlightActions {
  private readonly active = new Set<string>();

  begin(actionId: string): boolean {
    if (this.active.has(actionId)) {
      return false;
    }
    this.active.add(actionId);
    return true;
  }

  end(actionId: string): void {
    this.active.delete(actionId);
  }

  has(actionId: string): boolean {
    return this.active.has(actionId);
  }
}
