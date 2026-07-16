// Bundle the extension host entry for packaging.
//
// The extension ships as raw `dist/` files and is packaged with
// `--no-dependencies`, so node_modules is NOT included in the VSIX. Any workspace
// dependency imported for VALUES (e.g. @migrapilot/pilot-client — PilotError,
// ApprovalsClient, newRequestId) would then fail to resolve at activation. We
// therefore esbuild-bundle `src/extension.ts` into a single self-contained
// `dist/extension.js` (inlining pilot-client and every internal module),
// externalizing only `vscode` (provided by the host). Type-only imports
// (@migrapilot/protocol, shared-types) are erased and never enter the bundle.
//
// tsc -b still runs first for typechecking + emitting dist/test/* (the tests run
// UNBUNDLED from the dev tree, where the node_modules symlink resolves the
// package). This step only overwrites the packaged entry.

import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

console.log('bundled dist/extension.js (self-contained; vscode external)');
