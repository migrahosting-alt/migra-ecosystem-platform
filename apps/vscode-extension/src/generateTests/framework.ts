import path from 'node:path';
import { type TestProposal } from './proposal.js';

// Test-framework detection + CONSTRAINED command selection. The provider never
// chooses a shell command: commands come only from a fixed template keyed by a
// framework detected from trusted project config (package.json). Unknown → no
// command (tests are written but not executed).

export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'node-test' | 'unknown';

export interface PackageJsonLike {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface FrameworkInfo {
  framework: TestFramework;
  /** The package.json test script, if any (informational). */
  testScript?: string;
}

export function detectTestFramework(pkg: PackageJsonLike | undefined): FrameworkInfo {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const testScript = pkg?.scripts?.test;
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  let framework: TestFramework = 'unknown';
  if (has('vitest')) {
    framework = 'vitest';
  } else if (has('jest')) {
    framework = 'jest';
  } else if (has('mocha')) {
    framework = 'mocha';
  } else if (testScript && /\bnode\b.*--test/.test(testScript)) {
    framework = 'node-test';
  }
  return { framework, testScript };
}

/**
 * The narrowest safe command to run a single generated test file. Comes ONLY
 * from this fixed template — never from the provider. Returns null for unknown
 * frameworks (tests are written but not executed).
 */
export function selectTestCommand(framework: TestFramework, testRelPath: string): string[] | null {
  switch (framework) {
    case 'vitest':
      return ['npx', 'vitest', 'run', testRelPath];
    case 'jest':
      return ['npx', 'jest', testRelPath];
    case 'mocha':
      return ['npx', 'mocha', testRelPath];
    case 'node-test':
      return ['node', '--test', testRelPath];
    case 'unknown':
      return null;
  }
}

/** Sibling test path for a target source file (e.g. src/foo.ts → src/foo.test.ts). */
export function testPathFor(targetRelPath: string): string {
  const dir = path.posix.dirname(targetRelPath.split(path.sep).join('/'));
  const ext = path.posix.extname(targetRelPath);
  const base = path.posix.basename(targetRelPath, ext);
  const rel = dir === '.' ? `${base}.test${ext}` : `${dir}/${base}.test${ext}`;
  return rel;
}

/**
 * Deterministic test-generation fixture — the stub provider's contribution.
 * Produces a valid, framework-appropriate proposal (a smoke test) so
 * generateTests is exercised deterministically without a real model. Not a
 * user-facing placeholder: it is a real (trivial) test file.
 */
export function deterministicTestProposal(targetRelPath: string, framework: TestFramework): TestProposal {
  const testPath = testPathFor(targetRelPath);
  const name = path.posix.basename(targetRelPath);
  let contents: string;
  if (framework === 'node-test') {
    contents = [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      '',
      `test('${name} smoke', () => {`,
      '  assert.ok(true);',
      '});',
      '',
    ].join('\n');
  } else if (framework === 'mocha') {
    contents = [
      "import assert from 'node:assert/strict';",
      '',
      `describe('${name}', () => {`,
      "  it('smoke', () => {",
      '    assert.ok(true);',
      '  });',
      '});',
      '',
    ].join('\n');
  } else {
    // vitest / jest / unknown → vitest-style (also valid jest with globals)
    const imp = framework === 'jest' ? '' : "import { describe, it, expect } from 'vitest';\n\n";
    contents = [
      imp + `describe('${name}', () => {`,
      "  it('smoke', () => {",
      '    expect(true).toBe(true);',
      '  });',
      '});',
      '',
    ].join('\n');
  }
  return { files: [{ path: testPath, contents, mode: 'create' }] };
}
