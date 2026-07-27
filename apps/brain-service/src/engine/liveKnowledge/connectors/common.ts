/**
 * MigraAI Engine — shared foundation for authoritative connectors.
 *
 * An authoritative connector is an ENTITY LOOKUP, not a search engine. It answers
 * "what does the npm registry say about typescript" by reading npm's own API, which is
 * why its results can carry Tier 1: the answer comes from the party that defines it.
 * When no entity is recognisable in the question, the connector returns nothing, and
 * `official` reports insufficient authoritative evidence rather than guessing.
 *
 * Two rules every connector here follows:
 *
 *   1. Identifiers extracted from a query are VALIDATED against a strict pattern and
 *      URL-encoded before they reach a URL. A question is attacker-influenced text, so
 *      interpolating it into a path is a request-forgery primitive of its own.
 *   2. Credentials are read from the environment at availability time and never stored,
 *      returned, logged or rendered. What travels is the variable's NAME.
 */

import { sanitizeUntrustedText, type LiveFetchDeps } from '../liveFetch.js';
import type {
  ConnectorAvailability,
  ConnectorCoverage,
  ConnectorCredentialRef,
  DescribedConnector,
  LiveSearchResult,
} from '@migrapilot/protocol';

export interface ConnectorDeps {
  /** Transport, minus the budget — the research layer owns per-turn bounds. */
  fetch: Omit<LiveFetchDeps, 'budget'>;
  /** Injected rather than read from `process.env`, so tests configure without mutation. */
  env: Record<string, string | undefined>;
  now(): string;
}

/**
 * Availability from declared credentials and the current environment.
 *
 * A missing REQUIRED credential makes exactly this connector unavailable. A missing
 * optional one changes nothing, because it only buys a higher rate limit — treating it
 * as fatal would take a working deployment offline to protect it from a slower one.
 */
export function availabilityOf(
  connectorId: string,
  coverage: ConnectorCoverage,
  credentials: readonly ConnectorCredentialRef[] | undefined,
  env: Record<string, string | undefined>,
): ConnectorAvailability {
  const missing = (credentials ?? []).filter((c) => c.required && !env[c.envVar]?.trim());
  if (missing.length > 0) {
    return {
      connectorId,
      available: false,
      coverage,
      reason: 'missing-credential',
      // The NAME of each missing variable. An operator needs this; it is not a secret.
      detail: `set ${missing.map((c) => c.envVar).join(', ')}`,
    };
  }
  return { connectorId, available: true, coverage };
}

/** Authorization header from an optional token, or nothing at all. */
export function bearerIfPresent(
  env: Record<string, string | undefined>,
  envVar: string,
  scheme = 'Bearer',
): Record<string, string> {
  const token = env[envVar]?.trim();
  return token ? { Authorization: `${scheme} ${token}` } : {};
}

// ── Identifier extraction ────────────────────────────────────────────────────

/** `owner/repo`, GitHub's own character rules. */
const GITHUB_REPO = /\b([A-Za-z0-9][A-Za-z0-9-_.]{0,38})\/([A-Za-z0-9][A-Za-z0-9-_.]{0,99})\b/;

/** npm package, including a scope. */
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9-_.]{0,38}\/)?[a-z0-9][a-z0-9-_.]{0,127}$/;

/** PyPI project name (PEP 508 loosened to what the JSON API accepts). */
const PY_NAME = /^[A-Za-z0-9][A-Za-z0-9-_.]{0,99}$/;

/** OCI repository, optionally namespaced. */
const OCI_NAME = /^(?:[a-z0-9][a-z0-9-_.]{0,99}\/)?[a-z0-9][a-z0-9-_.]{0,127}$/;

const CVE_ID = /\b(CVE-\d{4}-\d{4,7})\b/i;
const GHSA_ID = /\b(GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4})\b/i;

export function extractGitHubRepo(query: string): { owner: string; repo: string } | undefined {
  const m = GITHUB_REPO.exec(query);
  if (!m) return undefined;
  // A version path like "4.9/2" or a date must not read as a repository.
  if (/^\d+$/.test(m[1]!) && /^\d+$/.test(m[2]!)) return undefined;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, '') };
}

/**
 * The package name a query is about, given the keywords that introduce one.
 *
 * Requiring a keyword is deliberate: guessing that a bare noun is a package name would
 * make the connector fire on nearly every question and consult a registry for words
 * that were never package names.
 */
export function extractPackageName(query: string, keywords: readonly string[], pattern: RegExp): string | undefined {
  const lowered = query.toLowerCase();
  for (const keyword of keywords) {
    const at = lowered.indexOf(keyword);
    if (at === -1) continue;
    // Scan FORWARD past filler rather than taking the adjacent token. "what does pypi
    // say about the requests package" put `say` next to the keyword, and taking it
    // fetched a real-but-wrong package and served it as authoritative Tier 1 evidence —
    // the worst failure available here, because the provenance looked perfect.
    const tokens = lowered
      .slice(at + keyword.length)
      .split(/[^@A-Za-z0-9\-_./]+/)
      .filter(Boolean)
      .slice(0, 6);
    for (const token of tokens) {
      const candidate = token.replace(/^\.+|[.,;:]+$/g, '');
      if (!candidate || STOPWORDS.has(candidate)) continue;
      if (pattern.test(candidate)) return candidate;
      // Neither filler nor a valid identifier: the sentence has moved on to another
      // clause, and scanning further would pick a word from it.
      break;
    }
  }
  return undefined;
}

/** Words that follow the keyword but name no package. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'registry', 'version', 'versions', 'latest',
  'install', 'update', 'metadata', 'info', 'i', 'we', 'it', 'this', 'that', 'and', 'or',
  'package', 'module', 'image', 'library', 'for', 'of', 'about', 'what', 'which',
  // Verbs and connectives that sit between the keyword and the actual identifier.
  'say', 'says', 'said', 'tell', 'tells', 'show', 'shows', 'list', 'lists', 'check',
  'know', 'knows', 'report', 'reports', 'have', 'has', 'does', 'do', 'did', 'in', 'on',
  'to', 'from', 'with', 'current', 'currently', 'me', 'us', 'you', 'my', 'our', 'its',
  'there', 'any', 'some', 'all', 'new', 'newest', 'released', 'release', 'releases',
]);

export const NAME_PATTERNS = { npm: NPM_NAME, pypi: PY_NAME, oci: OCI_NAME } as const;

export function extractAdvisoryIds(query: string): string[] {
  const ids: string[] = [];
  const cve = CVE_ID.exec(query);
  if (cve) ids.push(cve[1]!.toUpperCase());
  const ghsa = GHSA_ID.exec(query);
  if (ghsa) ids.push(ghsa[1]!.replace(/^ghsa/i, 'GHSA'));
  return ids;
}

// ── Result construction ──────────────────────────────────────────────────────

/**
 * Build a search result descriptor.
 *
 * No network call happens here: `search` decides WHICH authoritative endpoints answer
 * the question, and the research layer fetches only the ones the gate accepts. Probing
 * during search would double the request count for sources that get rejected anyway.
 */
export function describeResult(args: {
  connectorId: string;
  id: string;
  title: string;
  url: string;
  sourceType: LiveSearchResult['sourceType'];
  now: string;
  snippet?: string;
}): LiveSearchResult {
  return {
    id: args.id,
    connectorId: args.connectorId,
    title: args.title,
    url: args.url,
    domain: new URL(args.url).hostname,
    ...(args.snippet ? { snippet: sanitizeUntrustedText(args.snippet).slice(0, 300) } : {}),
    retrievedAt: args.now,
    // Tier 1 is a CLAIM. The gate re-checks it, and re-checks the URL, so a connector
    // cannot launder a non-authoritative source by asserting this.
    trustTier: 1,
    sourceType: args.sourceType,
  };
}

/** Render key/value evidence, sanitised, with a bounded free-text tail. */
export function renderEvidence(
  lines: Array<[string, string | number | undefined]>,
  body?: { label: string; text: string; maxChars: number },
): string {
  const head = lines
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${sanitizeUntrustedText(String(v))}`)
    .join('\n');
  if (!body?.text) return head;
  const trimmed = sanitizeUntrustedText(body.text).slice(0, body.maxChars);
  const truncated = body.text.length > body.maxChars ? ' […truncated]' : '';
  return `${head}\n${body.label}:\n${trimmed}${truncated}`;
}

/** Assemble a described connector from the parts each one actually differs in. */
export function defineConnector(spec: {
  id: string;
  domains: readonly string[];
  credentials?: readonly ConnectorCredentialRef[];
  deps: ConnectorDeps;
  search: DescribedConnector['search'];
  fetch: DescribedConnector['fetch'];
}): DescribedConnector {
  return {
    id: spec.id,
    coverage: 'authoritative',
    domains: spec.domains,
    ...(spec.credentials ? { credentials: spec.credentials } : {}),
    availability: () => availabilityOf(spec.id, 'authoritative', spec.credentials, spec.deps.env),
    search: spec.search,
    fetch: spec.fetch,
  };
}
