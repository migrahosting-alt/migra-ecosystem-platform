'use client'

/**
 * THE CATALOG — what Chat can offer, declared in one place.
 *
 * ---------------------------------------------------------------------------
 * WHAT BELONGS HERE, AND WHAT DOES NOT
 *
 * An entry declares a row's IDENTITY — its label, its hint, its icon — and
 * names the authority that decides whether it exists. It does not decide
 * availability itself, and it never carries a hardcoded boolean.
 *
 * There are exactly two kinds of authority:
 *
 *   local     a surface this app implements (photos, files, the library).
 *             Its readiness comes from the probe that already governed it.
 *
 *   registry  a capability the ENGINE executes. It renders only when the id is
 *             actually registered. Until then there is no row — see
 *             `resolveCapabilities.ts` for why absence, not greying out.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY MAPS, EMAIL, DRIVE AND GITHUB ARE STILL NOT LISTED
 *
 * They are later milestones, and it would be easy to declare them now so the
 * menu "looks" complete. They are deliberately absent, because a catalog entry
 * for a capability nobody has built is the same lie as a hardcoded button —
 * one indirection further away, which makes it harder to spot rather than less
 * false.
 *
 * Search is here because it is REGISTERED in the engine. It is not usable yet,
 * and that is a different fact: the row renders with the engine's own reason
 * rather than being hidden. Adding it took exactly what this slice predicted —
 * one entry naming a capability id, and no change to the composer.
 */

import type { CatalogEntry, LocalReadiness } from './resolveCapabilities'

/**
 * Readiness of every locally-implemented surface, gathered by the caller.
 *
 * Passed in rather than read here so the catalog stays a declaration: a module
 * that fetched its own state could not be reasoned about in one reading, and
 * this is the file someone will scan to answer "what can Chat do".
 */
export interface LocalProbes {
  /** Vision availability — a model approved AND the Brain reachable. */
  images: LocalReadiness | null
  /** Document availability — the file routes need an account. */
  documents: LocalReadiness | null
}

export function buildCatalog(probes: LocalProbes): CatalogEntry[] {
  return [
    {
      id: 'image',
      label: 'Photos & images',
      hint: 'Ask about a photo, a screenshot, or a chart.',
      icon: 'image',
      source: { kind: 'local', readiness: probes.images },
    },
    {
      id: 'file',
      label: 'Files & documents',
      hint: 'Attach a document, data file, or code for MigraPilot to read.',
      icon: 'file',
      source: { kind: 'local', readiness: probes.documents },
    },
    {
      /*
       * The library shares the documents authority because it is the same
       * storage: the row needs an account for exactly the reason the upload
       * row does, and giving it a second opinion is how two rows about one
       * capability start disagreeing.
       */
      id: 'library',
      label: 'Your files',
      hint: 'Reuse something you have already uploaded, without sending it again.',
      icon: 'file',
      source: { kind: 'local', readiness: probes.documents },
    },
    {
      /*
       * MIGRA SEARCH. The first engine-executed capability in this menu.
       *
       * Everything this file knows about it is on these four lines: a label, a
       * hint, an icon, and an id. It does not know which backend answers a
       * search, whether that backend is healthy, or that one is missing right
       * now — the engine owns all of it, and the reason a user sees when it
       * cannot run is a sentence the engine wrote.
       *
       * Today it renders as registered-but-unavailable: "Web search is not set
       * up yet." When a provider is configured the row becomes usable, with no
       * edit here.
       */
      id: 'web',
      label: 'Search the web',
      hint: 'Find current information and read the sources.',
      icon: 'globe',
      source: { kind: 'registry', capabilityId: 'migra.search' },
    },
    {
      /*
       * MIGRA EMAIL. Same four lines, same ignorance.
       *
       * This file does not know the provider is Gmail, what OAuth is, which
       * scopes are held, or whether an account is connected. It knows a label,
       * a hint, an icon and a capability id. The engine decides the rest, and
       * the sentence a user reads when it cannot run is one the engine wrote.
       *
       * Today: "Email is not set up yet."
       */
      id: 'email',
      label: 'Email',
      hint: 'Search and read your connected email.',
      icon: 'mail',
      source: { kind: 'registry', capabilityId: 'migra.email' },
    },
  ]
}

/**
 * Capability ids this catalog needs from the engine.
 *
 * Empty today, and that is the honest answer: no engine-executed capability is
 * offered in Chat yet. The caller uses this to decide whether to ask the
 * registry at all, so an empty catalog costs no request.
 */
export function registryIdsIn(catalog: readonly CatalogEntry[]): string[] {
  return catalog
    .filter((entry) => entry.source.kind === 'registry')
    .map((entry) => (entry.source as { capabilityId: string }).capabilityId)
}
