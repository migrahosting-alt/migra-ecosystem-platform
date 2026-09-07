/**
 * Reading the question, and refusing truthfully.
 *
 * The live proof is `scripts/verify-chat-project.mjs` — a sentinel found
 * through a real chat turn. These pin the two things a live run cannot
 * exercise cheaply: the intent boundary, and every refusal wording.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { detectProjectIntent } from './projectEvidence'

describe('reading the question', () => {
  it('a quoted string with a looking-for verb is unambiguous', () => {
    assert.deepEqual(detectProjectIntent('Find the string "SENTINEL_1" in my connected project'), {
      op: 'search',
      query: 'SENTINEL_1',
    })
    assert.deepEqual(detectProjectIntent("which files contain 'needle'?"), { op: 'search', query: 'needle' })
  })

  it('an unquoted target trailing "for" needs the question to be about a project', () => {
    assert.deepEqual(detectProjectIntent('search my repo for TODO_MARKER'), {
      op: 'search',
      query: 'TODO_MARKER',
    })
    // Same shape, nothing project-ish: not ours.
    assert.equal(detectProjectIntent('search the web for TODO_MARKER'), null)
  })

  it('listing and git status are recognised only about a project', () => {
    assert.deepEqual(detectProjectIntent('list the files in my project'), { op: 'list' })
    assert.deepEqual(detectProjectIntent('what changed files are in the repo?'), { op: 'git_status' })
    assert.equal(detectProjectIntent('list the countries in Europe'), null)
  })

  /*
   * 🚨 THE ASYMMETRY THAT DECIDES THE DEFAULT.
   *
   * A false negative costs a rephrase. A false positive spends a real
   * filesystem read on a turn that never asked for one and puts project
   * contents in front of an unrelated question. So anything uncertain is null.
   */
  it('an ordinary question never reaches the project', () => {
    for (const prompt of [
      'what is the capital of France?',
      'summarise this document',
      'write me a poem about files',
      'how do I find a good repository name?',
      '',
      '   ',
    ]) {
      assert.equal(detectProjectIntent(prompt), null, `${JSON.stringify(prompt)} should not inspect`)
    }
  })

  it('a quoted string alone is not enough — there must be an intent to look', () => {
    assert.equal(detectProjectIntent('translate "hello world" into French'), null)
  })
})
