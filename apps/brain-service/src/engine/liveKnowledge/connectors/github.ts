/**
 * GitHub connector — repositories, releases, issues, pull requests, Actions.
 *
 * Reads api.github.com only. A repository's own release is the definitive statement of
 * what that release is, which is what earns Tier 1 here; the same claim about a blog
 * post describing the release would not.
 *
 * `GITHUB_TOKEN` is OPTIONAL. Without it the API allows 60 requests an hour, which is
 * thin but real, so a missing token degrades the connector instead of disabling it.
 * Treating it as required would take a working deployment offline to protect it from a
 * slower one.
 */

import { fetchLiveJson } from '../liveFetch.js';
import {
  bearerIfPresent,
  defineConnector,
  describeResult,
  extractGitHubRepo,
  renderEvidence,
  type ConnectorDeps,
} from './common.js';
import type { DescribedConnector, LiveDocument, LiveSearchResult, LiveSourceReference } from '@migrapilot/protocol';

const API = 'https://api.github.com';
export const GITHUB_CONNECTOR_ID = 'github';

/** What the question is actually asking about a repository. */
type Intent = 'release' | 'issues' | 'pulls' | 'actions' | 'repo';

function intentOf(query: string): Intent[] {
  const q = query.toLowerCase();
  const intents: Intent[] = [];
  if (/\b(release|version|changelog|tag|latest|upgrade|update)\b/.test(q)) intents.push('release');
  if (/\b(issue|issues|bug report|regression)\b/.test(q)) intents.push('issues');
  if (/\b(pull request|pull requests|\bprs?\b|merge)\b/.test(q)) intents.push('pulls');
  if (/\b(action|actions|workflow|workflows|\bci\b|build status|pipeline)\b/.test(q)) intents.push('actions');
  // Repository metadata answers "what is X" and backs up every other intent.
  intents.push('repo');
  return intents.slice(0, 3);
}

export function createGitHubConnector(deps: ConnectorDeps): DescribedConnector {
  const credentials = [
    {
      envVar: 'GITHUB_TOKEN',
      required: false,
      purpose: 'raises the API rate limit from 60 to 5000 requests per hour',
    },
  ] as const;

  const headers = () => ({
    ...bearerIfPresent(deps.env, 'GITHUB_TOKEN'),
    // Pinning the API version keeps a silent upstream change from altering evidence shape.
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MigraPilot-Brain',
  });

  return defineConnector({
    id: GITHUB_CONNECTOR_ID,
    domains: ['api.github.com'],
    credentials,
    deps,
    async search(request): Promise<LiveSearchResult[]> {
      const repo = extractGitHubRepo(request.query);
      if (!repo) return []; // no entity, no authoritative answer
      const { owner, repo: name } = repo;
      const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
      const now = deps.now();
      const slug = `${owner}/${name}`;

      const endpoints: Record<Intent, { url: string; title: string; sourceType: LiveSearchResult['sourceType'] }> = {
        release: { url: `${base}/releases/latest`, title: `${slug} — latest release`, sourceType: 'release' },
        issues: { url: `${base}/issues?state=open&per_page=5&sort=updated`, title: `${slug} — open issues`, sourceType: 'official-api' },
        pulls: { url: `${base}/pulls?state=open&per_page=5&sort=updated`, title: `${slug} — open pull requests`, sourceType: 'official-api' },
        actions: { url: `${base}/actions/runs?per_page=5`, title: `${slug} — recent workflow runs`, sourceType: 'official-api' },
        repo: { url: base, title: `${slug} — repository`, sourceType: 'official-api' },
      };

      return intentOf(request.query)
        .slice(0, request.maxResults)
        .map((intent) =>
          describeResult({
            connectorId: GITHUB_CONNECTOR_ID,
            id: `github:${slug}:${intent}`,
            url: endpoints[intent].url,
            title: endpoints[intent].title,
            sourceType: endpoints[intent].sourceType,
            now,
          }),
        );
    },

    async fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument> {
      const { finalUrl, data } = await fetchLiveJson<GitHubPayload>(source.url, deps.fetch, { headers: headers() }, signal);
      const fetchedAt = deps.now();
      return {
        source: {
          id: source.id,
          connectorId: GITHUB_CONNECTOR_ID,
          title: titleFor(source.id, data),
          url: finalUrl,
          domain: new URL(finalUrl).hostname,
          retrievedAt: fetchedAt,
          trustTier: 1,
          sourceType: source.id.endsWith(':release') ? 'release' : 'official-api',
          ...(publishedAtOf(data) ? { publishedAt: publishedAtOf(data)! } : {}),
        },
        content: renderGitHub(source.id, data),
        contentHash: '', // stamped by the research layer, which owns hashing
        fetchedAt,
      };
    },
  });
}

type GitHubPayload = Record<string, unknown> | Array<Record<string, unknown>>;

const str = (o: Record<string, unknown> | undefined, k: string): string | undefined =>
  typeof o?.[k] === 'string' ? (o[k] as string) : undefined;

function titleFor(sourceId: string, data: GitHubPayload): string {
  if (Array.isArray(data)) return sourceId.split(':').slice(1).join(' ');
  const full = str(data, 'full_name');
  const tag = str(data, 'tag_name');
  if (tag) return `${full ?? sourceId.split(':')[1]} ${tag}`;
  return full ?? sourceId;
}

function publishedAtOf(data: GitHubPayload): string | undefined {
  if (Array.isArray(data)) return undefined;
  return str(data, 'published_at') ?? str(data, 'pushed_at') ?? str(data, 'updated_at');
}

/**
 * Render the payload as compact evidence.
 *
 * Release notes, issue titles and PR titles are USER-AUTHORED text arriving from a
 * first-party API — authoritative about the repository, not trustworthy as instruction —
 * so everything goes through the same sanitiser a scraped page gets, and free text is
 * bounded.
 */
function renderGitHub(sourceId: string, data: GitHubPayload): string {
  if (Array.isArray(data)) {
    const runs = sourceId.includes(':actions');
    return data
      .slice(0, 5)
      .map((item, i) => {
        if (runs) {
          return renderEvidence([
            [`run ${i + 1}`, str(item, 'name') ?? str(item, 'display_title')],
            ['status', `${str(item, 'status') ?? '?'} / ${str(item, 'conclusion') ?? 'pending'}`],
            ['branch', str(item, 'head_branch')],
            ['updated', str(item, 'updated_at')],
          ]);
        }
        return renderEvidence([
          [`#${item['number'] ?? i + 1}`, str(item, 'title')],
          ['state', str(item, 'state')],
          ['updated', str(item, 'updated_at')],
        ]);
      })
      .join('\n\n');
  }

  // A workflow-runs response is an object wrapping an array.
  if (Array.isArray(data['workflow_runs'])) {
    return renderGitHub(`${sourceId}:actions`, data['workflow_runs'] as Array<Record<string, unknown>>);
  }

  if (str(data, 'tag_name')) {
    return renderEvidence(
      [
        ['release', str(data, 'name') ?? str(data, 'tag_name')],
        ['tag', str(data, 'tag_name')],
        ['published', str(data, 'published_at')],
        ['prerelease', String(data['prerelease'] === true)],
        ['html_url', str(data, 'html_url')],
      ],
      { label: 'release notes', text: str(data, 'body') ?? '', maxChars: 4000 },
    );
  }

  return renderEvidence(
    [
      ['repository', str(data, 'full_name')],
      ['description', str(data, 'description')],
      ['default branch', str(data, 'default_branch')],
      ['language', str(data, 'language')],
      ['stars', typeof data['stargazers_count'] === 'number' ? (data['stargazers_count'] as number) : undefined],
      ['open issues', typeof data['open_issues_count'] === 'number' ? (data['open_issues_count'] as number) : undefined],
      ['archived', String(data['archived'] === true)],
      ['pushed', str(data, 'pushed_at')],
      ['license', str(data['license'] as Record<string, unknown> | undefined, 'spdx_id')],
    ],
    { label: 'topics', text: Array.isArray(data['topics']) ? (data['topics'] as string[]).join(', ') : '', maxChars: 400 },
  );
}
