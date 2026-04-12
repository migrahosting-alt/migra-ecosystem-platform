/**
 * Centralised Pilot-API connection config.
 * Every Next.js API-route proxy should import from here instead of
 * declaring its own constant — this prevents port-drift bugs.
 */

export const PILOT_API_BASE = (
  process.env.PILOT_API_URL ?? "http://localhost:3377"
).replace(/\/$/, "");

export const OPS_TOKEN = process.env.OPS_API_TOKEN;
