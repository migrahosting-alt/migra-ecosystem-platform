/**
 * Package-registry connectors — npm, PyPI, and OCI/Docker.
 *
 * Grouped because they answer the same question against three different authorities:
 * "what does the registry that publishes this artifact say about it". Each is separately
 * registrable and separately available, so one registry being down or unconfigured
 * cannot take the others with it.
 *
 * None of these require credentials for public metadata. The Docker Hub connector reads
 * the public v2 endpoint; a private registry would need a token, which is why the
 * credential is declared as optional rather than absent — declaring it makes the
 * eventual private-registry case configuration instead of a code change.
 */

import { fetchLiveJson } from '../liveFetch.js';
import {
  bearerIfPresent,
  defineConnector,
  describeResult,
  extractPackageName,
  NAME_PATTERNS,
  renderEvidence,
  type ConnectorDeps,
} from './common.js';
import type { DescribedConnector, LiveDocument, LiveSearchResult, LiveSourceReference } from '@migrapilot/protocol';

export const NPM_CONNECTOR_ID = 'npm-registry';
export const PYPI_CONNECTOR_ID = 'pypi';
export const OCI_CONNECTOR_ID = 'oci-registry';

// ── npm ──────────────────────────────────────────────────────────────────────

export function createNpmConnector(deps: ConnectorDeps): DescribedConnector {
  return defineConnector({
    id: NPM_CONNECTOR_ID,
    domains: ['registry.npmjs.org'],
    deps,
    async search(request): Promise<LiveSearchResult[]> {
      const name = extractPackageName(request.query, ['npm', 'node', 'yarn', 'pnpm', 'javascript', 'typescript package'], NAME_PATTERNS.npm);
      if (!name) return [];
      return [
        describeResult({
          connectorId: NPM_CONNECTOR_ID,
          id: `npm:${name}`,
          // The `/latest` manifest, NOT the full packument: typescript's packument is
          // 8.6 MB, seventeen times the per-document cap, so the whole-package endpoint
          // could only ever be refused for size. This one is ~5 KB and answers the
          // question actually being asked.
          // A scoped name's slash is part of the identifier, so it is encoded per segment.
          url: `https://registry.npmjs.org/${name.split('/').map(encodeURIComponent).join('/')}/latest`,
          title: `npm: ${name}`,
          sourceType: 'official-api',
          now: deps.now(),
        }),
      ];
    },
    async fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument> {
      const { finalUrl, data } = await fetchLiveJson<NpmManifest>(source.url, deps.fetch, {}, signal);
      const fetchedAt = deps.now();
      const latest = data.version;
      return {
        source: {
          id: source.id,
          connectorId: NPM_CONNECTOR_ID,
          title: `npm: ${data.name ?? source.id} ${latest ?? ''}`.trim(),
          url: finalUrl,
          domain: new URL(finalUrl).hostname,
          retrievedAt: fetchedAt,
          trustTier: 1,
          sourceType: 'official-api',
        },
        content: renderEvidence(
          [
            ['package', data.name],
            ['latest', latest],
            ['license', typeof data.license === 'string' ? data.license : undefined],
            ['deprecated', data.deprecated ? String(data.deprecated) : undefined],
            ['engines', data.engines ? JSON.stringify(data.engines) : undefined],
            ['integrity', typeof data.dist?.integrity === 'string' ? data.dist.integrity : undefined],
          ],
          { label: 'description', text: data.description ?? '', maxChars: 600 },
        ),
        contentHash: '',
        fetchedAt,
      };
    },
  });
}

/** The `/latest` manifest: one version, not the whole publication history. */
interface NpmManifest {
  name?: string;
  version?: string;
  description?: string;
  license?: unknown;
  deprecated?: unknown;
  engines?: unknown;
  dist?: { integrity?: unknown };
}

// ── PyPI ─────────────────────────────────────────────────────────────────────

export function createPyPiConnector(deps: ConnectorDeps): DescribedConnector {
  return defineConnector({
    id: PYPI_CONNECTOR_ID,
    domains: ['pypi.org'],
    deps,
    async search(request): Promise<LiveSearchResult[]> {
      const name = extractPackageName(request.query, ['pypi', 'pip', 'python'], NAME_PATTERNS.pypi);
      if (!name) return [];
      return [
        describeResult({
          connectorId: PYPI_CONNECTOR_ID,
          id: `pypi:${name}`,
          url: `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
          title: `PyPI: ${name}`,
          sourceType: 'official-api',
          now: deps.now(),
        }),
      ];
    },
    async fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument> {
      const { finalUrl, data } = await fetchLiveJson<PyPiPacket>(source.url, deps.fetch, {}, signal);
      const fetchedAt = deps.now();
      const info = data.info ?? {};
      const files = data.urls ?? [];
      return {
        source: {
          id: source.id,
          connectorId: PYPI_CONNECTOR_ID,
          title: `PyPI: ${info.name ?? source.id} ${info.version ?? ''}`.trim(),
          url: finalUrl,
          domain: new URL(finalUrl).hostname,
          retrievedAt: fetchedAt,
          trustTier: 1,
          sourceType: 'official-api',
          ...(files[0]?.upload_time_iso_8601 ? { publishedAt: files[0]!.upload_time_iso_8601! } : {}),
        },
        content: renderEvidence(
          [
            ['project', info.name],
            ['version', info.version],
            ['uploaded', files[0]?.upload_time_iso_8601],
            ['license', info.license],
            ['requires python', info.requires_python],
            ['yanked', files[0]?.yanked ? 'yes' : 'no'],
            ['releases known', data.releases ? Object.keys(data.releases).length : undefined],
          ],
          { label: 'summary', text: info.summary ?? '', maxChars: 600 },
        ),
        contentHash: '',
        fetchedAt,
      };
    },
  });
}

interface PyPiPacket {
  info?: { name?: string; version?: string; license?: string; requires_python?: string; summary?: string };
  urls?: Array<{ upload_time_iso_8601?: string; yanked?: boolean }>;
  releases?: Record<string, unknown>;
}

// ── OCI / Docker ─────────────────────────────────────────────────────────────

export function createOciConnector(deps: ConnectorDeps): DescribedConnector {
  const credentials = [
    { envVar: 'DOCKER_HUB_TOKEN', required: false, purpose: 'reads private repositories and raises the anonymous rate limit' },
  ] as const;

  return defineConnector({
    id: OCI_CONNECTOR_ID,
    domains: ['hub.docker.com'],
    credentials,
    deps,
    async search(request): Promise<LiveSearchResult[]> {
      const name = extractPackageName(request.query, ['docker', 'container', 'oci', 'image'], NAME_PATTERNS.oci);
      if (!name) return [];
      // An unqualified name is an official library image, which is Docker Hub's own rule.
      const repo = name.includes('/') ? name : `library/${name}`;
      return [
        describeResult({
          connectorId: OCI_CONNECTOR_ID,
          id: `oci:${repo}`,
          url: `https://hub.docker.com/v2/repositories/${repo.split('/').map(encodeURIComponent).join('/')}/tags?page_size=10&ordering=last_updated`,
          title: `Container image: ${repo}`,
          sourceType: 'official-api',
          now: deps.now(),
        }),
      ];
    },
    async fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument> {
      const { finalUrl, data } = await fetchLiveJson<OciPacket>(
        source.url,
        deps.fetch,
        { headers: bearerIfPresent(deps.env, 'DOCKER_HUB_TOKEN', 'JWT') },
        signal,
      );
      const fetchedAt = deps.now();
      const tags = data.results ?? [];
      return {
        source: {
          id: source.id,
          connectorId: OCI_CONNECTOR_ID,
          title: `${source.id.replace(/^oci:/, 'image ')} — ${tags.length} recent tags`,
          url: finalUrl,
          domain: new URL(finalUrl).hostname,
          retrievedAt: fetchedAt,
          trustTier: 1,
          sourceType: 'official-api',
          ...(tags[0]?.last_updated ? { publishedAt: tags[0]!.last_updated! } : {}),
        },
        content: tags
          .slice(0, 10)
          .map((t) =>
            renderEvidence([
              ['tag', t.name],
              ['updated', t.last_updated],
              ['size', typeof t.full_size === 'number' ? `${Math.round(t.full_size / 1024 / 1024)} MB` : undefined],
              ['digest', t.digest],
            ]),
          )
          .join('\n\n'),
        contentHash: '',
        fetchedAt,
      };
    },
  });
}

interface OciPacket {
  results?: Array<{ name?: string; last_updated?: string; full_size?: number; digest?: string }>;
}
