/**
 * MigraAI Engine — model qualification store.
 *
 * Installing a model does NOT make it production-approved. Every model carries a
 * qualification state; the capability router serves only `approved` models in
 * production, and rejected models are never served. The lifecycle is:
 *
 *   discovered → installed → benchmarking → approved
 *                                        ↘ restricted (approved only in evaluation)
 *                                        ↘ rejected   (failed/broken; never served)
 *   approved → deprecated  (superseded by a qualified successor; retired, never
 *              served — a retired model must never silently become the default
 *              again, so it is treated like `rejected` for serving purposes but
 *              kept distinct in provenance: it once qualified and worked.)
 *
 * The record of truth is a JSON manifest (license-aware) loaded at startup. A
 * model the registry discovers but that the manifest does not mention defaults to
 * `installed` — present, but NOT approved for production. Fail-closed: enforcement
 * is only active when the manifest says so, so an absent manifest preserves the
 * pre-qualification behavior rather than starving the router.
 */

import { readFileSync } from 'node:fs';

export type QualificationState = 'discovered' | 'installed' | 'benchmarking' | 'approved' | 'restricted' | 'rejected' | 'deprecated';

export interface QualificationInfo {
  state: QualificationState;
  /** Engine tier this model is approved to serve (fast|balanced|deep|vision|embedding). */
  tier?: string;
  license?: string;
  commercial?: boolean;
  reason?: string;
  benchmarkedAt?: string;
}

interface Manifest {
  /** `enforced` = production serves only approved models; `permissive` = the
   * router considers any non-rejected model (pre-qualification behavior). */
  mode?: 'enforced' | 'permissive';
  models?: Record<string, QualificationInfo>;
}

export class QualificationStore {
  private readonly models: Map<string, QualificationInfo>;
  readonly enforced: boolean;

  constructor(manifest: Manifest = {}) {
    this.models = new Map(Object.entries(manifest.models ?? {}));
    this.enforced = manifest.mode === 'enforced';
  }

  /**
   * Load a manifest from disk.
   *
   * ABSENT AND UNREADABLE ARE DIFFERENT, and conflating them was a real hazard.
   *
   * A MISSING file means no manifest was configured: a permissive store is
   * correct, because the engine must start on a deployment that has not adopted
   * qualification at all.
   *
   * A file that EXISTS but cannot be parsed is the opposite situation. Someone
   * configured a gate and it is broken — and the old behaviour answered that by
   * returning a permissive store with `enforced: false`, silently switching OFF
   * the control that decides which models may serve users. A typo disabled the
   * gate and nothing said so. That direction of failure is backwards for a
   * safety control, so a corrupt manifest now yields an ENFORCED store with no
   * approvals: nothing is served, loudly, rather than everything, quietly.
   */
  static fromFile(path: string): QualificationStore {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      // Genuinely absent — not configured.
      return new QualificationStore();
    }

    try {
      return new QualificationStore(JSON.parse(raw) as Manifest);
    } catch (error) {
      console.error(
        `[qualification] manifest at ${path} exists but could not be parsed; ` +
          'failing CLOSED (enforced, no approvals) rather than disabling the gate',
        error instanceof Error ? error.message : String(error),
      );
      return new QualificationStore({ mode: 'enforced', models: {} });
    }
  }

  /** Qualification for a model id. Unlisted installed models default to
   * `installed` (present, not approved). */
  get(modelId: string): QualificationInfo {
    return this.models.get(modelId) ?? { state: 'installed' };
  }

  /** Never-serve check — applies in every mode. Both a `rejected` (failed) and a
   * `deprecated` (retired/superseded) model are never served, so a retired model
   * can never silently return as a default or a failover target. */
  isRejected(modelId: string): boolean {
    const s = this.get(modelId).state;
    return s === 'rejected' || s === 'deprecated';
  }

  /** Superseded-and-retired check (distinct provenance from a hard rejection). */
  isDeprecated(modelId: string): boolean {
    return this.get(modelId).state === 'deprecated';
  }

  /** Serve-in-production check. */
  isApproved(modelId: string): boolean {
    return this.get(modelId).state === 'approved';
  }
}
