import type { Finding, ObserverContext } from "../types";

export async function healthObserver(_context: ObserverContext): Promise<Finding[]> {
  return [];
}
