/**
 * Copy must hand back the answer the user read.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { copyableText, speakableText } from './messageText'
import type { Block } from '@/data/types'

const para = (text: string): Block => ({ type: 'paragraph', text })

test('🚨 THE MEASURED CORRUPTION: copying code no longer breaks it', () => {
  const answer =
    'Here is the helper:\n\n```python\ndef f(*args, **kwargs):\n    return 2 ** 8\n```\n\n' +
    'That uses **kwargs** for keyword arguments.'
  const copied = copyableText([para(answer)])

  // The old handler produced `def f(*args, kwargs)` and `return 2  8`.
  assert.ok(copied.includes('def f(*args, **kwargs):'), 'kwargs must survive')
  assert.ok(copied.includes('return 2 ** 8'), 'exponentiation must survive')
  assert.equal(copied, answer, 'copy is verbatim — nothing added, nothing removed')
})

test('a plain answer is unchanged', () => {
  assert.equal(copyableText([para('The capital of Japan is Tokyo.')]), 'The capital of Japan is Tokyo.')
})

test('paragraphs keep their separation', () => {
  assert.equal(copyableText([para('One.'), para('Two.')]), 'One.\n\nTwo.')
})

test('a list is reconstructed as something a person can paste', () => {
  const bullets: Block = { type: 'list', variant: 'bullet', title: 'Steps', items: ['First', 'Second'] }
  assert.equal(copyableText([bullets]), 'Steps\n- First\n- Second')
  const numbered: Block = { type: 'list', variant: 'numbered', items: ['Alpha', 'Beta'] }
  assert.equal(copyableText([numbered]), '1. Alpha\n2. Beta')
})

test('empty blocks do not leave blank gaps', () => {
  assert.equal(copyableText([para('Only this.'), para('')]), 'Only this.')
  assert.equal(copyableText([]), '')
})

test('🚨 speech and clipboard are DIFFERENT jobs and stay separate', () => {
  const b = [para('Use **kwargs** and `pip install`.')]
  // Speech wants the symbols gone…
  assert.equal(speakableText(b).includes('**'), false)
  assert.equal(speakableText(b).includes('`'), false)
  // …and the clipboard must keep them.
  assert.ok(copyableText(b).includes('**kwargs**'))
  assert.ok(copyableText(b).includes('`pip install`'))
})
