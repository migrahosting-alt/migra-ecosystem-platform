/**
 * MigraPilot — qualified intelligence resolution.
 *
 * A caller states REQUIREMENTS. It never names a model, adapter, provider or file.
 *
 *   Engineer  →  qualifies and publishes  →  Brain  →  capabilities.json  →  THIS MODULE  →  commands
 *
 * Engineer is absent at runtime. This module reads only the contract Brain published; it
 * has no knowledge of Engineer's workspace, training layout, dataset locations or artifact
 * paths, and the contract is asserted to contain none.
 *
 * WHY NO FALLBACK EXISTS HERE
 * ---------------------------
 * The tempting shape is "resolve a capability, else use a sensible default model". That
 * default is how an estate silently ships unqualified intelligence to users: the capability
 * gate becomes decorative the first time it fails. So an unsatisfied requirement returns
 * `resolved: false` with a reason and NO handle. There is no second path to a model from
 * here — the same principle as `check-brain-transport.mjs` enforcing a single transport.
 *
 * This module performs NO inference. It answers "which qualified capability, if any" and
 * hands back identity plus constraints. Execution still goes through the governed Brain
 * transport, which remains the only way a model is reached.
 */

/** Promotion stages a product may consume. Ordered: later is more promoted. */
export const CONSUMABLE_STAGES = ['validated-candidate', 'staging', 'production'] as const;
export type ConsumableStage = (typeof CONSUMABLE_STAGES)[number];

const STAGE_RANK: Readonly<Record<string, number>> = {
  'validated-candidate': 1,
  staging: 2,
  production: 3,
};

const SUPPORTED_SCHEMA_MAJOR = '1.';

/** What a command receives: identity and constraints. Never a location. */
export interface CapabilityHandle {
  readonly capabilityId: string;
  readonly domain: string;
  readonly stage: ConsumableStage;
  readonly requestKeys: readonly string[];
  readonly modelId: string;
  readonly modelVersion: string;
  readonly artifactIdentityHash: string;
  readonly adapterIds: readonly string[];
  readonly languages: readonly string[];
  readonly intendedUses: readonly string[];
  readonly prohibitedUses: readonly string[];
  readonly publicationHash: string;
}

export interface CapabilityRequirements {
  readonly requestKeys: readonly string[];
  readonly languages?: readonly string[];
  /** Defaults to the LOWEST consumable stage; callers needing production must say so. */
  readonly minimumStage?: ConsumableStage;
}

export interface CapabilityResolution {
  readonly resolved: boolean;
  readonly handle?: CapabilityHandle;
  readonly reason: string;
}

/**
 * The published contract could not be read or understood.
 *
 * Deliberately NOT degraded to "no capabilities available": an empty list reads as a healthy
 * estate that has qualified nothing, which is indistinguishable from a broken publish. A
 * caller must be able to tell those apart.
 */
export class CapabilityContractUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityContractUnavailableError';
  }
}

/** Injected so tests and the host supply the contract without this module knowing a path. */
export interface CapabilityContractReader {
  read(): string | undefined;
  describe(): string;
}

export interface CapabilityContract {
  readonly schemaVersion: string;
  readonly capabilities: readonly CapabilityHandle[];
  readonly publishedAtIso?: string;
}

interface RawCapability {
  capabilityId: string;
  domain: string;
  stage: string;
  requestKeys: string[];
  artifact: { modelId: string; version: string; artifactIdentityHash: string; adapterIds?: string[] };
  constraints: { languages?: string[]; intendedUses?: string[]; prohibitedUses?: string[] };
  publicationHash: string;
}

function toHandle(raw: RawCapability): CapabilityHandle {
  return {
    capabilityId: raw.capabilityId,
    domain: raw.domain,
    stage: raw.stage as ConsumableStage,
    requestKeys: raw.requestKeys ?? [],
    modelId: raw.artifact.modelId,
    modelVersion: raw.artifact.version,
    artifactIdentityHash: raw.artifact.artifactIdentityHash,
    adapterIds: raw.artifact.adapterIds ?? [],
    languages: raw.constraints.languages ?? [],
    intendedUses: raw.constraints.intendedUses ?? [],
    prohibitedUses: raw.constraints.prohibitedUses ?? [],
    publicationHash: raw.publicationHash,
  };
}

/** Loads and validates the contract. Fails closed. */
export function loadCapabilityContract(reader: CapabilityContractReader): CapabilityContract {
  const raw = reader.read();
  if (raw === undefined) {
    throw new CapabilityContractUnavailableError(
      `No published capability contract at ${reader.describe()}. MigraPilot does not read MigraAI-Engineer at runtime; the contract is published by MigraAI-Brain.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CapabilityContractUnavailableError(
      `Capability contract at ${reader.describe()} is not valid JSON: ${(error as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new CapabilityContractUnavailableError('Capability contract root must be an object.');
  }
  const document = parsed as Record<string, unknown>;
  const schemaVersion = String(document['schemaVersion'] ?? '');
  if (!schemaVersion.startsWith(SUPPORTED_SCHEMA_MAJOR)) {
    throw new CapabilityContractUnavailableError(
      `Unsupported capability contract schemaVersion "${schemaVersion}"; this build supports ${SUPPORTED_SCHEMA_MAJOR}x`,
    );
  }
  const capabilities = document['capabilities'];
  if (!Array.isArray(capabilities)) {
    throw new CapabilityContractUnavailableError('Capability contract has no capabilities array.');
  }
  return {
    schemaVersion,
    publishedAtIso: typeof document['publishedAtIso'] === 'string' ? document['publishedAtIso'] : undefined,
    capabilities: capabilities.map((entry) => toHandle(entry as RawCapability)),
  };
}

/**
 * Resolve by requirements. Returns the MOST promoted capability satisfying every request
 * key, language and the minimum stage. Never substitutes a near miss.
 */
export function resolveCapability(
  contract: CapabilityContract,
  requirements: CapabilityRequirements,
): CapabilityResolution {
  if (requirements.requestKeys.length === 0) {
    return { resolved: false, reason: 'no capability requirements supplied' };
  }
  const minimumRank = STAGE_RANK[requirements.minimumStage ?? 'validated-candidate'] ?? 1;
  const required = requirements.languages ?? [];

  const candidates = contract.capabilities
    .filter((handle) => requirements.requestKeys.every((key) => handle.requestKeys.includes(key)))
    .filter((handle) => (STAGE_RANK[handle.stage] ?? 0) >= minimumRank)
    .filter((handle) => required.every((language) => handle.languages.includes(language)))
    .sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0));

  const best = candidates[0];
  if (best === undefined) {
    const detail = [
      `request keys [${requirements.requestKeys.join(', ')}]`,
      required.length > 0 ? `languages [${required.join(', ')}]` : undefined,
      `minimum stage ${requirements.minimumStage ?? 'validated-candidate'}`,
    ]
      .filter(Boolean)
      .join(', ');
    return { resolved: false, reason: `no qualified capability satisfies ${detail}` };
  }
  return { resolved: true, handle: best, reason: 'resolved' };
}

/**
 * Resolve or throw. For call sites where proceeding without qualified intelligence would
 * mean shipping unqualified output to a user.
 */
export function requireCapability(
  reader: CapabilityContractReader,
  requirements: CapabilityRequirements,
): CapabilityHandle {
  const resolution = resolveCapability(loadCapabilityContract(reader), requirements);
  if (!resolution.resolved || resolution.handle === undefined) {
    throw new CapabilityContractUnavailableError(resolution.reason);
  }
  return resolution.handle;
}
