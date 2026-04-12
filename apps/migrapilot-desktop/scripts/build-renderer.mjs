import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist', 'renderer');

fs.mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, 'src', 'renderer', 'index.tsx')],
  outfile: path.join(distDir, 'renderer.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: false,
  minify: false,
  jsx: 'automatic',
  logLevel: 'info'
});

fs.copyFileSync(
  path.join(projectRoot, 'src', 'renderer', 'index.html'),
  path.join(distDir, 'index.html')
);

console.log('Renderer build complete');
