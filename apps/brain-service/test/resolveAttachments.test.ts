/**
 * Resolving attachment refs into bytes a model may see.
 *
 * Intake already validated what ARRIVED. This validates what is about to reach a
 * model — separated from intake by time, by a filesystem, and by another
 * service. Every case here is something that can only go wrong in that gap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import {
  resolveAttachments,
  provenanceOf,
  provenanceTokenFor,
  type RequestedAttachment,
} from '../src/engine/media/resolveAttachments.js';

const SCOPE = 'owner:acct-1';
const OTHER = 'owner:acct-2';

function png(w: number, h: number, fill = 0): Buffer {
  const raw = Buffer.concat(Array.from({ length: h }, () =>
    Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, fill)])));
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t, 'ascii'), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const refOf = (n: number) => `img_${String(n).padStart(32, '0')}`;
const ask = (n: number, purpose: 'subject' | 'reference' = 'subject'): RequestedAttachment =>
  ({ ref: refOf(n), kind: 'image', purpose });

/** An in-memory library: `<dir>/<ref>.meta.json` and `<dir>/<ref>.png`. */
function libraryWith(entries: { n: number; data: Buffer; owner?: string; meta?: Record<string, unknown> }[]) {
  const files = new Map<string, Buffer>();
  for (const e of entries) {
    const ref = refOf(e.n);
    const meta = {
      id: ref, mime: 'image/png', bytes: e.data.byteLength,
      width: e.data.readUInt32BE(16), height: e.data.readUInt32BE(20),
      sha256: createHash('sha256').update(e.data).digest('hex'),
      ownerScope: e.owner ?? SCOPE,
      ...(e.meta ?? {}),
    };
    files.set(`/img/${ref}.meta.json`, Buffer.from(JSON.stringify(meta)));
    /*
     * Stored under the extension the RECORD claims, which is how the resolver
     * looks it up. Writing it as .png regardless made a mislabelled record read
     * as `not_found` — the resolver was right and the fixture was lying.
     */
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[String(meta.mime)] ?? 'png';
    files.set(`/img/${ref}.${ext}`, e.data);
  }
  return {
    files,
    deps: {
      imageDirectoryFor: async () => '/img',
      readFileImpl: async (path: string) => {
        const found = files.get(path);
        if (!found) throw new Error('ENOENT');
        return found;
      },
    },
  };
}

test('an ordered list resolves in order, with purpose preserved', async () => {
  const lib = libraryWith([{ n: 1, data: png(10, 4) }, { n: 2, data: png(6, 8, 2) }, { n: 3, data: png(5, 5, 3) }]);
  const out = await resolveAttachments(SCOPE, [ask(3), ask(1, 'reference'), ask(2)], lib.deps);

  assert.equal(out.rejected.length, 0);
  assert.deepEqual(out.resolved.map((r) => r.ref), [refOf(3), refOf(1), refOf(2)]);
  assert.deepEqual(out.resolved.map((r) => r.ordinal), [1, 2, 3]);
  assert.equal(out.resolved[1]?.purpose, 'reference');
})

test('dimensions and mime come from the BYTES, not the record', async () => {
  const data = png(21, 13);
  const lib = libraryWith([{ n: 1, data, meta: { width: 999, height: 999 } }]);
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  assert.equal(out.resolved[0]?.width, 21, 'measured, not trusted');
  assert.equal(out.resolved[0]?.height, 13);
  assert.equal(out.resolved[0]?.mime, 'image/png');
})

test('bytes changed under the record are refused as corrupt', async () => {
  /*
   * The gap intake cannot cover. Answering about these while citing the original
   * reference would attach the wrong provenance to the response.
   */
  const lib = libraryWith([{ n: 1, data: png(8, 8) }]);
  lib.files.set(`/img/${refOf(1)}.png`, png(8, 8, 9));
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  assert.equal(out.resolved.length, 0);
  assert.equal(out.rejected[0]?.reason, 'corrupt');
})

test("another scope's image is not authorized, even when it is right there", async () => {
  const lib = libraryWith([{ n: 1, data: png(7, 7), owner: OTHER }]);
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  assert.equal(out.resolved.length, 0);
  assert.equal(out.rejected[0]?.reason, 'not_authorized');
})

test('a record whose id disagrees with its ref is corrupt, not merely missing', async () => {
  const lib = libraryWith([{ n: 1, data: png(4, 4), meta: { id: refOf(2) } }]);
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  assert.equal(out.rejected[0]?.reason, 'corrupt');
})

test('bytes that are not the type they claim are refused', async () => {
  const lib = libraryWith([{ n: 1, data: png(4, 4), meta: { mime: 'image/gif' } }]);
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  assert.equal(out.rejected[0]?.reason, 'type_mismatch');
})

test('no registered storage is storage_unavailable, never not_found', async () => {
  /*
   * Nothing was searched. Reporting "no such image" would be a claim about a
   * library that was never opened.
   */
  const out = await resolveAttachments(SCOPE, [ask(1)], { imageDirectoryFor: async () => null });
  assert.equal(out.rejected[0]?.reason, 'storage_unavailable');

  const threw = await resolveAttachments(SCOPE, [ask(1)], {
    imageDirectoryFor: async () => { throw new Error('registry down'); },
  });
  assert.equal(threw.rejected[0]?.reason, 'storage_unavailable');
})

test('a missing image is not_found', async () => {
  const lib = libraryWith([]);
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  assert.equal(out.rejected[0]?.reason, 'not_found');
})

test('a hostile ref never reaches storage', async () => {
  let touched = 0;
  const deps = {
    imageDirectoryFor: async () => '/img',
    readFileImpl: async () => { touched += 1; throw new Error('ENOENT'); },
  };
  const hostile = ['../../etc/passwd', '/etc/passwd', 'img_' + 'Z'.repeat(32), 'img_' + 'a'.repeat(31), ''];
  const out = await resolveAttachments(SCOPE, hostile.map((ref) => ({ ref, kind: 'image' as const, purpose: 'subject' as const })), deps);
  assert.equal(out.resolved.length, 0);
  assert.ok(out.rejected.every((r) => r.reason === 'invalid_ref'));
  assert.equal(touched, 0, 'a malformed ref must be refused before any read is attempted');
})

test('duplicates are refused exactly as the contract refuses them', async () => {
  const lib = libraryWith([{ n: 1, data: png(5, 5) }]);
  const out = await resolveAttachments(SCOPE, [ask(1), ask(1)], lib.deps);
  assert.equal(out.resolved.length, 1)
  assert.equal(out.rejected[0]?.reason, 'duplicate_ref');
})

test('one bad attachment does not discard the good ones', async () => {
  const lib = libraryWith([{ n: 1, data: png(6, 6) }, { n: 3, data: png(9, 3) }]);
  const out = await resolveAttachments(SCOPE, [ask(1), ask(2), ask(3)], lib.deps);
  assert.deepEqual(out.resolved.map((r) => r.ref), [refOf(1), refOf(3)]);
  assert.equal(out.rejected[0]?.ref, refOf(2));
  /* Ordinals reflect the REQUESTED position, so "image 3" still means the third
   * thing the user attached even when the second failed. */
  assert.equal(out.rejected[0]?.ordinal, 2);
  assert.equal(out.resolved[1]?.ordinal, 3);
})

test('the provenance token identifies both position and exact bytes', async () => {
  const first = png(10, 10, 1);
  const lib = libraryWith([{ n: 1, data: first }]);
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  const image = out.resolved[0]!;
  assert.equal(image.provenance, provenanceTokenFor(1, image.sha256));
  assert.match(image.provenance, /^image:1:sha256-[0-9a-f]{16}$/);

  /* Different bytes must not inherit the old token, or an altered image would
   * carry the original's provenance into an answer. */
  const lib2 = libraryWith([{ n: 1, data: png(10, 10, 2) }]);
  const out2 = await resolveAttachments(SCOPE, [ask(1)], lib2.deps);
  assert.notEqual(out2.resolved[0]?.provenance, image.provenance);
})

test('what may be logged cannot contain the image', async () => {
  const lib = libraryWith([{ n: 1, data: png(12, 12) }]);
  const out = await resolveAttachments(SCOPE, [ask(1)], lib.deps);
  const safe = provenanceOf(out.resolved[0]!);
  assert.ok(!('data' in safe), 'the bytes must not be loggable through this helper');
  for (const value of Object.values(safe)) {
    assert.ok(typeof value === 'string' || typeof value === 'number');
  }
  assert.ok(JSON.stringify(safe).length < 400);
})
