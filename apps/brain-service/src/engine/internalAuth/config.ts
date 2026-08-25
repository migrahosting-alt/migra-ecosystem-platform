import type { VerifyDeps } from './assertion.js';

/**
 * Which callers may perform privileged Brain mutations, and with which keys.
 *
 * TWO SEPARATE QUESTIONS, KEPT SEPARATE. The key set answers "is this caller who
 * it says it is"; the service policy answers "may that caller do this". Merging
 * them — a key that implies universal privilege — is exactly what makes a leaked
 * secret catastrophic rather than merely bad.
 *
 * EACH CALLER GETS ITS OWN IDENTITY AND ITS OWN KEY. The operator CLI and a
 * future Command Center bridge perform the same operation, and they still must
 * not share an identity: when one is compromised, the blast radius should be one
 * caller and the revocation should be one key.
 *
 * KEYS COME FROM THE ENVIRONMENT ONLY. Never a literal, never a default, never a
 * file this repository contains — a signing key with a fallback value is not a
 * signing key.
 */

/** `platform.models.qualify` — the only privileged action defined so far. */
export const ACTION_MODELS_QUALIFY = 'platform.models.qualify';

/** The operator CLI. Deliberately narrow: this identity may do exactly one thing. */
export const SERVICE_QUALIFICATION_CLI = 'migrapilot-qualification-cli';

const SERVICE_POLICY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [SERVICE_QUALIFICATION_CLI, new Set([ACTION_MODELS_QUALIFY])],
]);

/**
 * Active signing keys, by id.
 *
 * VERSIONED SO ROTATION IS ADDITIVE: add `..._V2`, switch the signer, remove
 * `..._V1`. At no point must both sides change together, and at no point is
 * there a window where a valid caller cannot be verified.
 *
 * A key shorter than 32 bytes of entropy is refused rather than accepted with a
 * warning — a MAC key that is really a password is a MAC in name only, and the
 * failure would be silent.
 */
const MIN_KEY_LENGTH = 64; // 32 bytes, hex-encoded

export function loadSigningKeys(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^MIGRAPILOT_QUALIFICATION_SIGNING_KEY_(V[0-9]+)$/.exec(name);
    if (!match || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length < MIN_KEY_LENGTH) {
      console.error(
        `[internal-auth] ${name} is too short (${trimmed.length} chars; need at least ${MIN_KEY_LENGTH}); ignoring it`,
      );
      continue;
    }
    keys.set(match[1]!.toLowerCase(), trimmed);
  }
  return keys;
}

export interface InternalAuthConfig {
  keys: Map<string, string>;
  servicePolicy: ReadonlyMap<string, ReadonlySet<string>>;
  /** False when no usable key is configured — privileged routes then refuse everything. */
  enabled: boolean;
}

export function loadInternalAuthConfig(env: NodeJS.ProcessEnv = process.env): InternalAuthConfig {
  const keys = loadSigningKeys(env);
  /*
   * NO KEY MEANS NO PRIVILEGED MUTATION, not "skip the check". A deployment
   * without the secret must be unable to qualify models, never able to qualify
   * them without proof.
   */
  return { keys, servicePolicy: SERVICE_POLICY, enabled: keys.size > 0 };
}

export function verifyDepsFrom(
  config: InternalAuthConfig,
  rememberRequestId: VerifyDeps['rememberRequestId'],
): VerifyDeps {
  return { keys: config.keys, servicePolicy: config.servicePolicy, rememberRequestId };
}
