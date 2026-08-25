/**
 * Resolving opaque refs to bytes.
 *
 * The boundary being tested: what the browser sends is a ref and nothing else,
 * and a ref that cannot produce verified bytes for THIS caller produces none.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isImageId } from './images'

test('only content-addressed refs are eligible to be looked up', () => {
  /*
   * Anything else is refused before the store is asked. Looking it up anyway is
   * how a path or a filename gets interpreted as a name.
   */
  assert.equal(isImageId('img_' + 'a'.repeat(32)), true)
  for (const bad of [
    '../../etc/passwd',
    '/var/lib/migrapilot/images/x.png',
    'photo.png',
    'img_' + 'a'.repeat(31),
    'img_' + 'A'.repeat(32),
    'IMG_' + 'a'.repeat(32),
    '',
  ]) {
    assert.equal(isImageId(bad), false, `${bad || '(empty)'} must not be treated as a ref`)
  }
})
