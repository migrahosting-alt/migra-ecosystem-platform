/**
 * Model output → structured blocks.
 *
 * The regression these exist for: every answer was wrapped in one paragraph and
 * rendered as plain text, so `### Key Design Elements`, `**bold**` and fenced
 * code appeared on screen as literal characters. The transcript was showing raw
 * model output rather than an answer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown, parseInline, safeHref, looksLikeMarkdown } from './parse'

const text = (spans: { kind: string; text?: string }[]) => spans.map((s) => s.text ?? '').join('')

test('headings become headings, not literal hashes', () => {
  const [block] = parseMarkdown('### Key Design Elements')
  assert.equal(block!.kind, 'heading')
  if (block!.kind === 'heading') {
    assert.equal(block.level, 3)
    assert.equal(text(block.spans), 'Key Design Elements')
    assert.ok(!text(block.spans).includes('#'), 'the marker must not survive into the text')
  }
})

test('emphasis, inline code and links are structure, not characters', () => {
  const spans = parseInline('Use **bold**, some `code`, and [a link](https://example.test).')
  const kinds = spans.map((s) => s.kind)
  assert.ok(kinds.includes('strong'))
  assert.ok(kinds.includes('code'))
  assert.ok(kinds.includes('link'))
  assert.ok(!text(spans).includes('**'), 'no asterisks may reach the reader')
  assert.ok(!text(spans).includes('`'))
})

test('a code fence is never interpreted as markdown', () => {
  /*
   * A model explaining markdown puts `###` inside a fence. Parsing it would
   * rewrite the very answer it was trying to show.
   */
  const blocks = parseMarkdown('Here:\n\n```md\n### not a heading\n**not bold**\n```\n\nDone.')
  const code = blocks.find((b) => b.kind === 'code')
  assert.ok(code)
  if (code.kind === 'code') {
    assert.equal(code.language, 'md')
    assert.match(code.code, /### not a heading/)
    assert.match(code.code, /\*\*not bold\*\*/)
  }
  assert.equal(blocks.filter((b) => b.kind === 'heading').length, 0)
})

test('both list flavours parse, and keep their order', () => {
  const bullets = parseMarkdown('- one\n- two\n- three')[0]!
  assert.equal(bullets.kind, 'list')
  if (bullets.kind === 'list') {
    assert.equal(bullets.ordered, false)
    assert.deepEqual(bullets.items.map(text), ['one', 'two', 'three'])
  }
  const numbered = parseMarkdown('1. first\n2. second')[0]!
  if (numbered.kind === 'list') {
    assert.equal(numbered.ordered, true)
    assert.deepEqual(numbered.items.map(text), ['first', 'second'])
  }
})

test('a table needs its separator row to be a table', () => {
  const blocks = parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
  assert.equal(blocks[0]!.kind, 'table')
  if (blocks[0]!.kind === 'table') {
    assert.deepEqual(blocks[0]!.header.map(text), ['a', 'b'])
    assert.deepEqual(blocks[0]!.rows.map((r) => r.map(text)), [['1', '2']])
  }
  // Without the separator these are just sentences that happen to contain pipes.
  assert.equal(parseMarkdown('a | b\nc | d')[0]!.kind, 'paragraph')
})

test('quotes and rules parse', () => {
  assert.equal(parseMarkdown('> quoted thought')[0]!.kind, 'quote')
  assert.equal(parseMarkdown('---')[0]!.kind, 'rule')
})

test('a plain sentence stays one paragraph', () => {
  // Short answers must not gain structure they never had.
  const blocks = parseMarkdown('It is a bouquet of pink tulips in a glass vase.')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]!.kind, 'paragraph')
})

test('a javascript: link is rendered as text, never as a link', () => {
  /*
   * Model output is untrusted text. It cannot become markup — the renderer
   * builds React elements and never injects HTML — but an anchor with a script
   * scheme would still execute on click, so the scheme is checked here.
   */
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('data:text/html,<script>'), null)
  assert.equal(safeHref('https://example.test'), 'https://example.test')
  assert.equal(safeHref('mailto:a@b.test'), 'mailto:a@b.test')

  const spans = parseInline('[click](javascript:alert(1))')
  assert.equal(spans.every((s) => s.kind !== 'link'), true, 'no link element may be produced')
})

test('markup nobody should see raw is detectable', () => {
  assert.equal(looksLikeMarkdown('### Heading'), true)
  assert.equal(looksLikeMarkdown('plain sentence'), false)
})

test('parsing terminates on pathological input', () => {
  // A model can emit unbalanced markers; the parser must not spin on them.
  const started = Date.now()
  parseMarkdown('*'.repeat(400) + '\n' + '`'.repeat(400))
  assert.ok(Date.now() - started < 2000)
})
