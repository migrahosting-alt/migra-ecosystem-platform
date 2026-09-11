// Regression for the "invent src/audit.ts instead of inspecting MigraPanel"
// defect: the protocol prompt sent to the model must require locating the real
// owning module for a request naming an existing product, and must recognize an
// operational (non-code) request instead of defaulting to file creation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEngineerTask, type EngineerToolInfo } from '../src/engine/engineer/engineerRuntime.js';

const TOOLS: EngineerToolInfo[] = [
  { id: 'workspace.search', description: 'search', readOnly: true, inputHint: '{}' },
  { id: 'workspace.list', description: 'list', readOnly: true, inputHint: '{}' },
  { id: 'fs.proposeChangeset', description: 'propose', readOnly: true, inputHint: '{}' },
];

async function drainAndCapturePrompt(task: string): Promise<string> {
  let captured = '';
  const events = runEngineerTask(
    {
      complete: async (prompt: string) => {
        captured = prompt;
        return '{"final":"done"}';
      },
      executeTool: async () => ({}),
      listFiles: async () => [],
      tools: TOOLS,
    },
    { rootPath: '/ws', task },
  );
  for await (const _ of events) {
    /* drain to completion; only the prompt matters here */
  }
  return captured;
}

test('a request naming an existing product must be told to locate the real owning module first', async () => {
  const prompt = await drainAndCapturePrompt('Create audit@annoupale.com in MigraPanel');
  assert.match(prompt, /locate the REAL owning code/);
  assert.match(prompt, /Inventing a new top-level file[\s\S]*?is WRONG/);
});

test('the prompt distinguishes an operational request from a code change', async () => {
  const prompt = await drainAndCapturePrompt('Create audit@annoupale.com in MigraPanel');
  assert.match(prompt, /operational rather than a code change/i);
  assert.match(prompt, /name\s+the real mechanism you found/i);
});

test('build-from-scratch guidance still applies when nothing existing is named', async () => {
  const prompt = await drainAndCapturePrompt('Build a snake game as a new standalone script');
  assert.match(prompt, /BUILD FROM SCRATCH/);
  assert.match(prompt, /brand-new script, page, component or app with NO existing counterpart/);
});
