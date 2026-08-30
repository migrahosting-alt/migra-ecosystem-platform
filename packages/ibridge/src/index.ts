/**
 * iBridge: compute decision and execution authority.
 *
 * ONE job manifest, run local or remote by an allocator that fails closed, with
 * `@migrateck/evidence` as a hard dependency — the allocator's decision is a
 * checkable claim before any money is spent, and a job cannot close until its
 * outputs are verified and its worker is gone.
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION. There is no RunPod client here. These are
 * the controls a provider integration must pass through, which is what stops a
 * "local implementation" and a "RunPod implementation" from drifting apart.
 */
export * from './manifest.js';
export * from './allocator.js';
export * from './execution.js';
