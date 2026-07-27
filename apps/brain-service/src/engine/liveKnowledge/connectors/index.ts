/**
 * MigraAI Engine — the authoritative connector set.
 *
 * Seven connectors, all Tier 1, all reading first-party endpoints. There is deliberately
 * no general-web provider here: `official` must be provably authoritative before broad
 * search exists, and a `web` mode that silently borrows authoritative results while
 * implying full coverage would be a worse lie than having no web mode at all.
 *
 * Every connector is built the same way and registered independently, so an outage or a
 * missing credential removes exactly one and the rest still answer.
 */

import { createGitHubConnector } from './github.js';
import { createNpmConnector, createOciConnector, createPyPiConnector } from './registries.js';
import {
  createAdvisoryConnector,
  createStatusConnector,
  createVendorDocsConnector,
  type VendorDocSite,
  type VendorStatusEndpoint,
} from './advisories.js';
import type { ConnectorDeps } from './common.js';
import type { DescribedConnector } from '@migrapilot/protocol';

export * from './common.js';
export * from './github.js';
export * from './registries.js';
export * from './advisories.js';

/**
 * Vendor documentation domains, with the subtree each is authoritative for.
 *
 * Conservative on purpose: a domain here becomes fetchable, so the list is the operator's
 * statement about who counts as a vendor rather than a convenience default. Each entry
 * pins a path prefix so an allowlisted domain cannot serve as an open proxy for its
 * entire site.
 */
export const DEFAULT_VENDOR_DOC_SITES: readonly VendorDocSite[] = [
  // `/docs/` is an Apache directory listing, which is a real page and useless evidence.
  // `/api/` is the documentation. Verified against the live host, not assumed.
  { vendor: 'Node.js', domain: 'nodejs.org', keywords: ['node.js', 'nodejs', 'node api'], basePath: '/api/' },
  { vendor: 'TypeScript', domain: 'www.typescriptlang.org', keywords: ['typescript', 'tsconfig'], basePath: '/docs/' },
  { vendor: 'PostgreSQL', domain: 'www.postgresql.org', keywords: ['postgres', 'postgresql'], basePath: '/docs/' },
  { vendor: 'Python', domain: 'docs.python.org', keywords: ['python'], basePath: '/3/' },
  // `/en-US/docs/` 301s to `/en-US/docs/Web`; naming the target avoids a redirect that
  // would then have to be re-checked against this prefix.
  { vendor: 'MDN', domain: 'developer.mozilla.org', keywords: ['mdn', 'web api', 'javascript api'], basePath: '/en-US/docs/Web' },
];

/**
 * Vendor status endpoints.
 *
 * Statuspage-compatible summaries, which is what most of these vendors publish. A status
 * document is only useful minutes old, which is why `statusPageSeconds` is five minutes
 * rather than an hour.
 */
export const DEFAULT_STATUS_ENDPOINTS: readonly VendorStatusEndpoint[] = [
  { vendor: 'GitHub', url: 'https://www.githubstatus.com/api/v2/summary.json', keywords: ['github'] },
  { vendor: 'npm', url: 'https://status.npmjs.org/api/v2/summary.json', keywords: ['npm', 'registry'] },
  { vendor: 'Cloudflare', url: 'https://www.cloudflarestatus.com/api/v2/summary.json', keywords: ['cloudflare'] },
  { vendor: 'Stripe', url: 'https://status.stripe.com/api/v2/summary.json', keywords: ['stripe'] },
  { vendor: 'OpenAI', url: 'https://status.openai.com/api/v2/summary.json', keywords: ['openai'] },
];

export interface AuthoritativeConnectorConfig {
  vendorDocSites?: readonly VendorDocSite[];
  statusEndpoints?: readonly VendorStatusEndpoint[];
}

/**
 * Build every authoritative connector.
 *
 * Returned regardless of availability, because an unavailable connector still has to be
 * REPORTABLE — dropping it here would turn a missing credential into a connector that
 * seems never to have existed.
 */
export function buildAuthoritativeConnectors(
  deps: ConnectorDeps,
  config: AuthoritativeConnectorConfig = {},
): DescribedConnector[] {
  return [
    createGitHubConnector(deps),
    createNpmConnector(deps),
    createPyPiConnector(deps),
    createOciConnector(deps),
    createAdvisoryConnector(deps),
    createVendorDocsConnector(deps, config.vendorDocSites ?? DEFAULT_VENDOR_DOC_SITES),
    createStatusConnector(deps, config.statusEndpoints ?? DEFAULT_STATUS_ENDPOINTS),
  ];
}
