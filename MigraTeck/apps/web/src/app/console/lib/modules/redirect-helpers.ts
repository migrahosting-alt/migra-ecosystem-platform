import { redirect } from "next/navigation";

/**
 * Synchronous redirect-with-error helpers. Lives in its own file (not in
 * client-actions.ts) because Next.js requires every export of a "use server"
 * file to be an async function.
 */

export const buildErrorUrl = (basePath: string, error: string): string => {
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}error=${encodeURIComponent(error)}`;
};

/** Throws a Next.js redirect — call from inside a server action's catch. */
export const redirectWithError = (basePath: string, error: string): never => {
  redirect(buildErrorUrl(basePath, error));
};
