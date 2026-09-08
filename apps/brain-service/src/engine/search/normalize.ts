/**
 * CANONICALISATION AND DEDUPLICATION.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT COSMETIC
 *
 * A federated backend returns the same article many times: the publisher, three
 * syndicators, an AMP copy, a mirror, and the same URL twice with different
 * tracking parameters. Left alone, one story occupies the whole result set,
 * the model reads it five times, and the answer cites five "independent"
 * sources that are one source. That is a manufactured appearance of
 * corroboration, which is worse than a thin answer.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT DONE HERE
 *
 * No guessing. Two URLs collapse only on evidence — identical canonical form,
 * or an AMP/mirror form that DEMONSTRABLY maps to a known original. Similar
 * titles from different domains are left alone: two outlets covering one event
 * really are two sources, and merging them would hide genuine agreement.
 */

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'ref', 'ref_src',
  'source', 'spm', 'scid', 'yclid', 'twclid', 'ttclid', '_hsenc', '_hsmi',
  'vero_id', 'wickedid', 'oly_enc_id', 'oly_anon_id', 'trk', 'trkCampaign',
]);

/**
 * The canonical form of a URL, for comparison and citation.
 *
 * Returns the input unchanged when it cannot be parsed. A URL we do not
 * understand is still a URL the provider returned, and dropping it would lose
 * a real result to make the dedup table tidier.
 */
export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  // Scheme and host are case-insensitive; the path is not.
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  // `http` and `https` for the same host are the same document in practice, and
  // a provider returning both is a duplicate rather than two sources.
  if (url.protocol === 'http:') url.protocol = 'https:';

  // Default ports carry no meaning.
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }

  // `www.` is a hosting convention, not an identity.
  if (url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4);

  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param.toLowerCase())) url.searchParams.delete(param);
  }
  // Stable order, so two identical queries written differently compare equal.
  url.searchParams.sort();

  /*
   * A fragment addresses a place WITHIN a document, so it is dropped for
   * identity — except for the SPA convention `#!`, where it is the only thing
   * distinguishing two documents and dropping it would merge unrelated pages.
   */
  if (!url.hash.startsWith('#!')) url.hash = '';

  // A trailing slash on a path is not a different document.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/**
 * The registrable domain, for authority and diversity signals.
 *
 * Deliberately naive about multi-part public suffixes: without a public-suffix
 * list, `example.co.uk` would reduce to `co.uk` and make every UK site look
 * like one source. So only the common `www.` prefix is removed and the rest is
 * left intact — a slightly long domain is harmless, a wrongly-merged one is not.
 */
export function domainOf(raw: string): string {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

/**
 * AMP and reader-mode mirrors that map provably back to an original.
 *
 * Only forms where the original is RECOVERABLE from the mirror URL itself are
 * handled. Anything requiring a network round-trip to resolve belongs in the
 * fetch layer, not in a pure normaliser.
 */
export function resolveMirror(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  // https://www-example-com.cdn.ampproject.org/c/s/www.example.com/article
  if (url.hostname.endsWith('.cdn.ampproject.org')) {
    const marker = url.pathname.match(/^\/[cv]\/(s\/)?(.+)$/);
    if (marker?.[2]) return `https://${marker[2]}`;
  }
  // Google AMP viewer: /amp/s/example.com/article
  if (url.hostname === 'google.com' || url.hostname === 'www.google.com') {
    const amp = url.pathname.match(/^\/amp\/(s\/)?(.+)$/);
    if (amp?.[2]) return `https://${amp[2]}`;
  }
  // A trailing /amp or ?amp=1 on the publisher's own domain.
  if (url.pathname.endsWith('/amp')) {
    url.pathname = url.pathname.slice(0, -4);
    return url.toString();
  }
  return raw;
}

/** Canonical identity of a result: mirror resolved, then canonicalised. */
export function identityOf(rawUrl: string): string {
  return canonicalizeUrl(resolveMirror(rawUrl));
}

export interface Deduplicable {
  url: string;
  title: string;
  snippet: string;
  providerRank: number;
}

/**
 * Collapse duplicates, keeping the best-ranked survivor of each group.
 *
 * "Best" is the provider's own rank, because at this stage Migra ranking has
 * not run yet and inventing a preference here would silently pre-empt it.
 *
 * Returns survivors in their original relative order — this stage removes, it
 * does not reorder. Reordering is `rank.ts`'s job, and doing both here would
 * make it impossible to tell which stage produced a given result order.
 */
export function deduplicate<T extends Deduplicable>(results: readonly T[]): T[] {
  /*
   * 🚨 TWO PROPERTIES, AND KEEPING ONLY ONE IS A BUG.
   *
   * A first draft kept the best-ranked member and then filtered the original
   * array. Where rank and position disagree, that silently MOVED a group to
   * the position of its later member — a reorder produced by a stage whose
   * whole contract is that it only removes. Real providers return results in
   * rank order, so it would have gone unnoticed until one did not.
   *
   * So a group is anchored at its EARLIEST appearance, and the member kept is
   * the best-ranked one. Position is the group's; content is the best copy's.
   */
  const bestByIdentity = new Map<string, { member: T; firstIndex: number }>();

  results.forEach((result, index) => {
    const identity = identityOf(result.url);
    const existing = bestByIdentity.get(identity);
    if (!existing) {
      bestByIdentity.set(identity, { member: result, firstIndex: index });
      return;
    }
    // Anchor never moves; only the member may be replaced by a better one.
    if (result.providerRank < existing.member.providerRank) {
      bestByIdentity.set(identity, { member: result, firstIndex: existing.firstIndex });
    }
  });

  return [...bestByIdentity.values()]
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((entry) => entry.member);
}

/**
 * Whether two snippets are near-identical — syndication with a different
 * headline, which URL comparison alone cannot catch.
 *
 * A deliberately blunt token-overlap test rather than an embedding: it must be
 * explainable in a test failure and cost nothing. The threshold is high
 * because a false merge silently DELETES a source, which is the more expensive
 * mistake of the two.
 */
export function nearlyIdentical(a: string, b: string, threshold = 0.9): boolean {
  const tokens = (s: string) =>
    new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 2));
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return false;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  // Jaccard: shared over union. Containment would call a long article a
  // duplicate of its own one-line summary.
  const union = left.size + right.size - shared;
  return union > 0 && shared / union >= threshold;
}
