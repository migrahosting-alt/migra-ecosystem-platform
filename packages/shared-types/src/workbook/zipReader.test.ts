/**
 * The ZIP reader exists because a workbook parser must not be a new dependency:
 * the deploy hardlinks node_modules from the previous release and never
 * installs, so a new package is simply absent in production.
 *
 * It reads files uploaded by strangers, so the tests that matter are the
 * refusals. A reader that accepts a malformed archive and returns something
 * plausible is how a confident wrong number gets produced.
 *
 * The fixtures are built by python's zipfile, deliberately not by this code, so
 * the bytes under test were produced by an independent implementation.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { describe, it } from 'node:test'

import { ZipError, looksLikeZip, readNamedEntry, readZipEntries, readZipEntry } from './zipReader.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const load = (name: string): Buffer => readFileSync(join(FIXTURES, name))

describe('zipReader', () => {
  it('lists the parts of a real workbook', () => {
    const names = readZipEntries(load('workbook_basic.xlsx')).map((e) => e.name)
    assert.ok(names.includes('xl/workbook.xml'), names.join(','))
    assert.ok(names.includes('xl/worksheets/sheet1.xml'), names.join(','))
    assert.ok(names.includes('xl/sharedStrings.xml'), names.join(','))
  })

  it('decompresses a part to well-formed xml', () => {
    const wb = readNamedEntry(load('workbook_basic.xlsx'), 'xl/workbook.xml')
    assert.ok(wb, 'workbook.xml missing')
    const text = wb!.toString('utf8')
    assert.match(text, /<sheets>/)
    assert.match(text, /name="Sales"/)
  })

  it('returns undefined for a part the archive does not contain', () => {
    assert.equal(readNamedEntry(load('workbook_basic.xlsx'), 'xl/nope.xml'), undefined)
  })

  it('reads a zip that is not a workbook without pretending otherwise', () => {
    // Structurally a valid archive; simply not a spreadsheet. That distinction
    // belongs to the workbook layer, so the zip layer must succeed here.
    const names = readZipEntries(load('workbook_malformed.xlsx')).map((e) => e.name)
    assert.deepEqual(names, ['hello.txt'])
    assert.equal(readNamedEntry(load('workbook_malformed.xlsx'), 'xl/workbook.xml'), undefined)
  })

  describe('refusals', () => {
    it('refuses something that is not an archive', () => {
      assert.throws(() => readZipEntries(Buffer.from('Region,Revenue\nNorth,100')), ZipError)
    })

    it('refuses a buffer too small to be one', () => {
      assert.throws(() => readZipEntries(Buffer.alloc(8)), ZipError)
    })

    it('refuses a truncated archive', () => {
      const full = load('workbook_basic.xlsx')
      assert.throws(() => readZipEntries(full.subarray(0, full.length - 40)), ZipError)
    })

    it('refuses an entry whose declared size is absurd', () => {
      // A zip bomb's trick is a small archive that expands without limit. The
      // declared size is refused before anything is allocated.
      const entry = {
        name: 'huge.bin',
        compressionMethod: 8,
        compressedSize: 100,
        uncompressedSize: 5 * 1024 * 1024 * 1024,
        localHeaderOffset: 0,
      }
      assert.throws(() => readZipEntry(load('workbook_basic.xlsx'), entry), ZipError)
    })

    it('refuses an unsupported compression method', () => {
      const buf = load('workbook_basic.xlsx')
      const real = readZipEntries(buf)[0]!
      assert.throws(
        () => readZipEntry(buf, { ...real, compressionMethod: 99 }),
        /compression method 99/,
      )
    })

    it('refuses data that does not actually inflate', () => {
      // Deflate-flagged bytes that are not a deflate stream. The reader must
      // raise rather than hand back whatever partial output it managed.
      const junk = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.alloc(22),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('this is not deflate data'),
      ])
      const entry = {
        name: 'x',
        compressionMethod: 8,
        compressedSize: 24,
        uncompressedSize: 100,
        localHeaderOffset: 0,
      }
      assert.throws(() => readZipEntry(junk, entry), ZipError)
    })
  })

  describe('looksLikeZip', () => {
    it('recognises a workbook and rejects csv text', () => {
      assert.equal(looksLikeZip(load('workbook_basic.xlsx')), true)
      assert.equal(looksLikeZip(Buffer.from('Region,Revenue\nNorth,100000\n')), false)
      assert.equal(looksLikeZip(Buffer.alloc(2)), false)
    })
  })

  it('round-trips a stored (uncompressed) entry', () => {
    // Method 0 is legal and some writers use it for tiny parts.
    const payload = Buffer.from('<x>stored</x>')
    const deflated = deflateRawSync(payload)
    assert.ok(deflated.length > 0)
    // Build a minimal archive by hand to exercise method 0 specifically.
    const name = Buffer.from('a.xml')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(0, 8) // method 0
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(payload.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(0, 42)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(1, 10)
    const centralOffset = local.length + name.length + payload.length
    eocd.writeUInt32LE(centralOffset, 16)
    const buf = Buffer.concat([local, name, payload, central, name, eocd])
    assert.equal(readNamedEntry(buf, 'a.xml')?.toString('utf8'), '<x>stored</x>')
  })
})
