/**
 * The qualification boundary must accept every capability the product depends on.
 *
 * THE DEFECT THIS PINS. `ModelCapability` declared `chat.general`, `chat.fast`,
 * `chat.long_context` and `reasoning.deep`. The model-family catalog named all
 * four as the `governedCapability` of Migra Core, Swift, Atlas and Logic. The
 * runtime guard in qualificationRoutes did NOT list them, so every request about
 * them was refused `unknown_capability`.
 *
 * The visible symptom was four dead entries in the consumer's model picker
 * reading "no approved model for chat.general". The real state was worse than
 * missing approvals: those families were unqualifiable by construction, and
 * issuing the approval through the canonical signed path would have been
 * rejected at the boundary. The typecheck passed the whole time — which is the
 * point. A type is a claim; only a value crossing the boundary is evidence.
 *
 * The assertion is derived from the catalog rather than restating a list, so a
 * family that starts declaring a new governed capability fails here instead of
 * silently becoming unapprovable in production.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MIGRA_MODEL_FAMILIES } from '@migrapilot/shared-types/model-families';

import {
  acceptsCapability,
  governedCapabilitiesInCatalog,
} from '../src/engine/media/qualificationRoutes.js';

describe('qualification capability boundary', () => {
  it('accepts every governed capability the model-family catalog declares', () => {
    const declared = governedCapabilitiesInCatalog();
    assert.ok(declared.length > 0, 'the catalog declares no governed capabilities at all');

    const refused = declared.filter((c) => !acceptsCapability(c));
    assert.deepEqual(
      refused,
      [],
      `these capabilities are declared by a model family but refused at the qualification ` +
        `boundary, which makes those families unqualifiable by construction: ${refused.join(', ')}`,
    );
  });

  it('covers the four that were actually missing', () => {
    // Named explicitly as a regression: these are the ones production refused.
    for (const capability of ['chat.general', 'chat.fast', 'chat.long_context', 'reasoning.deep']) {
      assert.equal(acceptsCapability(capability), true, `${capability} is refused`);
    }
  });

  it('derives the catalog list from the catalog, not from a copy', () => {
    const declared = new Set(governedCapabilitiesInCatalog());
    const fromCatalog = new Set(
      Object.values(MIGRA_MODEL_FAMILIES)
        .map((f) => f.requirements.governedCapability)
        .filter((c): c is string => Boolean(c)),
    );
    assert.deepEqual([...declared].sort(), [...fromCatalog].sort());
  });

  it('still refuses something that is not a capability', () => {
    // Widening the list must not have turned the guard into a rubber stamp.
    for (const value of ['', 'nonsense', 'chat.', '.general', 'CHAT.GENERAL', 42, null, undefined]) {
      assert.equal(acceptsCapability(value), false, `wrongly accepted ${String(value)}`);
    }
  });

  it('keeps the legacy broad names readable', () => {
    // Existing decisions were written against these; dropping them would orphan them.
    for (const capability of ['vision', 'vision.general', 'vision.object_counting', 'coding']) {
      assert.equal(acceptsCapability(capability), true, `${capability} was dropped`);
    }
  });
});
