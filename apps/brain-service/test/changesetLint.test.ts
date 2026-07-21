// The changeset sanity-check catches OBVIOUS botched-edit defects (duplicate
// definitions, leaked tool-call markup, merge markers, broken JSON) so the
// engineer can self-correct before a bad edit reaches the user's files. It must
// be high-signal: clean code produces NO defects. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintChangeset, summarizeDefects } from '../src/tools/changesetLint.js';

test('clean whole-file edits produce no defects', () => {
  assert.deepEqual(
    lintChangeset([
      { op: 'create', path: 'src/calc.js', content: 'export function sum(a,b){return a+b;}\nexport function mul(a,b){return a*b;}\n' },
      { op: 'replace', path: 'package.json', content: '{"name":"x","version":"1.0.0"}' },
    ]),
    [],
  );
});

test('flags a duplicated top-level definition (the classic botched rename)', () => {
  const d = lintChangeset([{ op: 'replace', path: 'src/main.js',
    content: "import { sum } from './calc.js';\nexport function total(i){return i.reduce((s,x)=>add(s,x),0);}\nexport function total(i){return i.reduce((s,x)=>sum(s,x),0);}\n" }]);
  assert.equal(d.length, 1);
  assert.match(d[0]!.issue, /defines 'total' 2/);
});

test('flags leaked tool-call markup and merge markers', () => {
  assert.match(lintChangeset([{ op: 'create', path: 'a.ts', content: 'const x=1;\n<function=read><parameter=path>a</parameter></function>' }])[0]!.issue, /tool-call markup/);
  assert.match(lintChangeset([{ op: 'create', path: 'a.ts', content: '<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n' }])[0]!.issue, /merge-conflict/);
});

test('flags broken JSON and empty content', () => {
  assert.match(lintChangeset([{ op: 'create', path: 'tsconfig.json', content: '{ bad json,, }' }])[0]!.issue, /not valid JSON/);
  assert.match(lintChangeset([{ op: 'create', path: 'x.ts', content: '   ' }])[0]!.issue, /empty/);
});

test('patch/delete/mkdir ops and non-code files are not over-flagged', () => {
  assert.deepEqual(lintChangeset([{ op: 'patch', path: 'a.ts', content: '@@ -1 +1 @@' }]), [], 'patch content is not a whole file');
  assert.deepEqual(lintChangeset([{ op: 'delete', path: 'a.ts' }]), []);
  assert.deepEqual(lintChangeset([{ op: 'create', path: 'README.md', content: '# Title\n\n# Title\n' }]), [], 'markdown repeated headings are fine');
  assert.match(summarizeDefects([{ path: 'a.ts', issue: 'x' }]), /`a\.ts` x/);
});
