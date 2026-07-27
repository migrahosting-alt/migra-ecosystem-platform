/**
 * Security-advisory, vendor-documentation and status connectors.
 *
 * These three share a property the package registries do not: what counts as
 * authoritative is a LIST an operator controls. A CVE is authoritative because OSV and
 * the GitHub advisory database say so; a vendor doc is authoritative because the
 * operator declared that domain to be the vendor's own; a status page is authoritative
 * because it is the vendor's published endpoint.
 *
 * So the allowlist is data, not code, and an empty allowlist means the connector has
 * nothing to be authoritative about — it reports `not-configured` rather than falling
 * back to whatever the query happened to name.
 */

import { fetchLiveJson, guardedRequest, sanitizeUntrustedText } from '../liveFetch.js';
import { availabilityOf, defineConnector, describeResult, extractAdvisoryIds, renderEvidence, type ConnectorDeps } from './common.js';
import type {
  ConnectorAvailability,
  DescribedConnector,
  LiveDocument,
  LiveSearchResult,
  LiveSourceReference,
} from '@migrapilot/protocol';

export const ADVISORY_CONNECTOR_ID = 'security-advisories';
export const VENDOR_DOCS_CONNECTOR_ID = 'vendor-docs';
export const STATUS_CONNECTOR_ID = 'vendor-status';

// ── Security advisories (OSV) ────────────────────────────────────────────────

/**
 * OSV aggregates GitHub advisories, distro trackers and language ecosystems behind one
 * public API, so a single connector covers CVE and GHSA identifiers without a key.
 */
export function createAdvisoryConnector(deps: ConnectorDeps): DescribedConnector {
  return defineConnector({
    id: ADVISORY_CONNECTOR_ID,
    domains: ['api.osv.dev'],
    deps,
    async search(request): Promise<LiveSearchResult[]> {
      const ids = extractAdvisoryIds(request.query);
      if (ids.length === 0) return []; // an advisory needs an identifier, not a topic
      const now = deps.now();
      return ids.slice(0, request.maxResults).map((id) =>
        describeResult({
          connectorId: ADVISORY_CONNECTOR_ID,
          id: `advisory:${id}`,
          url: `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`,
          title: `Advisory ${id}`,
          sourceType: 'security-advisory',
          now,
        }),
      );
    },
    async fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument> {
      const { finalUrl, data } = await fetchLiveJson<OsvPacket>(source.url, deps.fetch, {}, signal);
      const fetchedAt = deps.now();
      const severity = data.severity?.map((s) => `${s.type}=${s.score}`).join(' ');
      const affected = (data.affected ?? [])
        .slice(0, 6)
        .map((a) => `${a.package?.ecosystem ?? '?'}/${a.package?.name ?? '?'}`)
        .join(', ');
      return {
        source: {
          id: source.id,
          connectorId: ADVISORY_CONNECTOR_ID,
          title: `${data.id ?? source.id}: ${data.summary ?? 'advisory'}`.slice(0, 200),
          url: finalUrl,
          domain: new URL(finalUrl).hostname,
          retrievedAt: fetchedAt,
          trustTier: 1,
          sourceType: 'security-advisory',
          ...(data.published ? { publishedAt: data.published } : {}),
        },
        content: renderEvidence(
          [
            ['advisory', data.id],
            ['aliases', data.aliases?.join(', ')],
            ['published', data.published],
            ['modified', data.modified],
            ['severity', severity],
            ['affected', affected],
            ['withdrawn', data.withdrawn],
          ],
          { label: 'details', text: data.details ?? data.summary ?? '', maxChars: 3000 },
        ),
        contentHash: '',
        fetchedAt,
      };
    },
  });
}

interface OsvPacket {
  id?: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  published?: string;
  modified?: string;
  withdrawn?: string;
  severity?: Array<{ type?: string; score?: string }>;
  affected?: Array<{ package?: { ecosystem?: string; name?: string } }>;
}

// ── Vendor documentation, by explicit allowlist ──────────────────────────────

export interface VendorDocSite {
  /** Operator-facing label, e.g. "Node.js". */
  vendor: string;
  /** Exact host. A subdomain is a different host and needs its own entry. */
  domain: string;
  /** Words in a question that mean this vendor. */
  keywords: readonly string[];
  /**
   * Where a documentation lookup starts. Only paths under this prefix are fetchable, so
   * an allowlisted domain cannot become an open proxy for its whole site.
   */
  basePath: string;
}

export function createVendorDocsConnector(deps: ConnectorDeps, sites: readonly VendorDocSite[]): DescribedConnector {
  const domains = sites.map((s) => s.domain);
  const base = defineConnector({
    id: VENDOR_DOCS_CONNECTOR_ID,
    domains,
    deps,
    async search(request): Promise<LiveSearchResult[]> {
      const q = request.query.toLowerCase();
      const now = deps.now();
      return sites
        .filter((site) => site.keywords.some((k) => q.includes(k.toLowerCase())))
        .slice(0, request.maxResults)
        .map((site) =>
          describeResult({
            connectorId: VENDOR_DOCS_CONNECTOR_ID,
            id: `docs:${site.domain}`,
            url: `https://${site.domain}${site.basePath}`,
            title: `${site.vendor} documentation`,
            sourceType: 'official-docs',
            now,
          }),
        );
    },
    async fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument> {
      // The path prefix is re-checked at fetch time. `search` produced this URL, but a
      // fetch reached by any other route must not escape the allowlisted subtree.
      const url = new URL(source.url);
      const site = sites.find((s) => s.domain === url.hostname && url.pathname.startsWith(s.basePath));
      if (!site) throw new Error(`vendor-docs: ${url.hostname} is not an allowlisted documentation path`);

      const { finalUrl, contentType, raw } = await guardedRequest(source.url, deps.fetch, {}, signal);

      // The prefix is re-checked on where the bytes ACTUALLY came from. A 301 out of the
      // allowlisted subtree would otherwise land anywhere on the domain and still be
      // labelled that vendor's documentation — the SSRF hop checks kept it off the
      // private network, not inside the subtree an operator approved.
      const landed = new URL(finalUrl);
      const stillAllowed = sites.some((s) => s.domain === landed.hostname && landed.pathname.startsWith(s.basePath));
      if (!stillAllowed) {
        throw new Error(`vendor-docs: redirected out of the allowlisted documentation path`);
      }

      const fetchedAt = deps.now();
      // Documentation is HTML, so it goes through the full active-content removal.
      const { extractSafeText } = await import('../liveFetch.js');
      return {
        source: {
          id: source.id,
          connectorId: VENDOR_DOCS_CONNECTOR_ID,
          title: `${site.vendor} documentation`,
          url: finalUrl,
          domain: new URL(finalUrl).hostname,
          retrievedAt: fetchedAt,
          trustTier: 1,
          sourceType: 'official-docs',
        },
        content: sanitizeUntrustedText(extractSafeText(raw, contentType)).slice(0, 20_000),
        contentHash: '',
        fetchedAt,
      };
    },
  });

  // An empty allowlist is a configuration state, not a failure: the connector simply has
  // no vendor it is authoritative for, and says so by name.
  return sites.length === 0
    ? {
        ...base,
        availability: (): ConnectorAvailability => ({
          connectorId: VENDOR_DOCS_CONNECTOR_ID,
          available: false,
          coverage: 'authoritative',
          reason: 'not-configured',
          detail: 'no vendor documentation domains are allowlisted',
        }),
      }
    : base;
}

// ── Vendor status endpoints ─────────────────────────────────────────────────

export interface VendorStatusEndpoint {
  vendor: string;
  /** A Statuspage-compatible summary endpoint, or any JSON status document. */
  url: string;
  keywords: readonly string[];
}

export function createStatusConnector(deps: ConnectorDeps, endpoints: readonly VendorStatusEndpoint[]): DescribedConnector {
  const domains = endpoints.map((e) => new URL(e.url).hostname);
  const base = defineConnector({
    id: STATUS_CONNECTOR_ID,
    domains,
    deps,
    async search(request): Promise<LiveSearchResult[]> {
      const q = request.query.toLowerCase();
      // A status page answers an availability question. Without one of these words the
      // question is about behaviour, and a status summary would be noise.
      if (!/\b(status|outage|down|degraded|incident|availability|uptime|is .* up)\b/.test(q)) return [];
      const now = deps.now();
      return endpoints
        .filter((e) => e.keywords.some((k) => q.includes(k.toLowerCase())))
        .slice(0, request.maxResults)
        .map((e) =>
          describeResult({
            connectorId: STATUS_CONNECTOR_ID,
            id: `status:${e.vendor.toLowerCase()}`,
            url: e.url,
            title: `${e.vendor} service status`,
            sourceType: 'status-page',
            now,
          }),
        );
    },
    async fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument> {
      const { finalUrl, data } = await fetchLiveJson<StatusPacket>(source.url, deps.fetch, {}, signal);
      const fetchedAt = deps.now();
      const incidents = (data.incidents ?? []).slice(0, 5);
      return {
        source: {
          id: source.id,
          connectorId: STATUS_CONNECTOR_ID,
          title: `${data.page?.name ?? source.id} — ${data.status?.description ?? 'status'}`,
          url: finalUrl,
          domain: new URL(finalUrl).hostname,
          retrievedAt: fetchedAt,
          trustTier: 1,
          sourceType: 'status-page',
          ...(data.page?.updated_at ? { publishedAt: data.page.updated_at } : {}),
        },
        content: renderEvidence([
          ['service', data.page?.name],
          ['indicator', data.status?.indicator],
          ['description', data.status?.description],
          ['updated', data.page?.updated_at],
          [
            'open incidents',
            incidents.length === 0
              ? 'none'
              : incidents.map((i) => `${i.name ?? '?'} (${i.status ?? '?'}/${i.impact ?? '?'})`).join('; '),
          ],
        ]),
        contentHash: '',
        fetchedAt,
      };
    },
  });

  return endpoints.length === 0
    ? {
        ...base,
        availability: (): ConnectorAvailability => ({
          connectorId: STATUS_CONNECTOR_ID,
          available: false,
          coverage: 'authoritative',
          reason: 'not-configured',
          detail: 'no vendor status endpoints are configured',
        }),
      }
    : base;
}

interface StatusPacket {
  page?: { name?: string; updated_at?: string };
  status?: { indicator?: string; description?: string };
  incidents?: Array<{ name?: string; status?: string; impact?: string }>;
}

/** Availability helper re-exported so the registry can describe an unbuilt connector. */
export { availabilityOf };
