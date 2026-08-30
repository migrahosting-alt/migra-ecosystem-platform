/**
 * Shared enforcement primitive for evidence-backed claims.
 *
 * SHARED ON PURPOSE. A copy of this inside each product would drift, and the
 * copy that drifted would be the one that started accepting unevidenced claims.
 * One implementation, imported everywhere.
 */
export * from './evidence.js';
export * from './transition.js';
export * from './ledger.js';
