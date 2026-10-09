import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { candidateGit, containedPath, nodeChangesetFs } from '@migrapilot/workspace-tools';

const fs = nodeChangesetFs();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function manifest(root: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(containedPath(root, 'package.json', fs), 'utf8'));
  if (!isRecord(value)) throw new Error('Dependency preparation requires an actual package.json object.');
  return value;
}

export function candidateHasDependencies(root: string): boolean {
  const value = manifest(root);
  let present = false;
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = value[key];
    if (entries === undefined) continue;
    if (!isRecord(entries) || Object.values(entries).some(entry => typeof entry !== 'string')) {
      throw new Error(`Invalid package.json ${key}; dependency preparation cannot use this manifest.`);
    }
    present ||= Object.keys(entries).length > 0;
  }
  return present;
}

export interface CandidateDependencyPlan {
  command: string[];
  fingerprint: string;
  timeoutMs: number;
}

function assertLocalPath(root: string, path: string): string {
  const delta = relative(root, resolve(root, path)).replace(/\\/g, '/');
  if (!path || isAbsolute(path) || delta === '..' || delta.startsWith('../') || isAbsolute(delta)
    || path.includes('\\') || /[\0\r\n]/.test(path)) {
    throw new Error('Locked dependency path escapes the candidate or is unsupported.');
  }
  return delta;
}

export function candidateDependencyPlan(root: string): CandidateDependencyPlan {
  const value = manifest(root);
  if ('workspaces' in value) throw new Error('Workspace/monorepo dependency preparation is not yet qualified. Prepare it separately.');
  if (existsSync(resolve(root, '.npmrc'))) {
    throw new Error('Project .npmrc is not supported for candidate preparation. No credentials were read; prepare dependencies separately.');
  }
  if (existsSync(resolve(root, 'npm-shrinkwrap.json'))) throw new Error('Candidate preparation currently requires package-lock.json, not npm-shrinkwrap.json.');
  const lockPath = containedPath(root, 'package-lock.json', fs);
  if (!existsSync(lockPath)) throw new Error('Locked candidate preparation requires package-lock.json. No lockfile is generated or dependency versions guessed.');
  const lock: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (!isRecord(lock) || (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !isRecord(lock.packages)) {
    throw new Error('Candidate preparation requires an npm v2/v3 package-lock.json with package entries.');
  }
  const tracked = new Set(candidateGit(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  if ([...tracked].some(path => /(^|\/)node_modules\//.test(path))) {
    throw new Error('Tracked node_modules is not supported for candidate preparation.');
  }
  try {
    if (candidateGit(root, ['check-ignore', '--no-index', 'node_modules/']) !== 'node_modules/') throw new Error('Ignore node_modules/ before preparing candidate dependencies.');
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 1) throw new Error('Ignore node_modules/ before preparing candidate dependencies.');
    throw error;
  }
  const assets = new Set(['package.json', 'package-lock.json']);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path && (!path.startsWith('node_modules/') || path !== assertLocalPath(root, path))) {
      throw new Error('Locked package paths must be canonical locations under node_modules/.');
    }
    if (!isRecord(entry)) throw new Error('Invalid locked package entry.');
    if (entry.link === true) throw new Error('Linked/local-directory dependencies are not yet qualified. Use a locked contained tarball or prepare separately.');
    if (typeof entry.resolved !== 'string') continue;
    if (entry.resolved.startsWith('file:')) {
      const path = assertLocalPath(root, decodeURIComponent(entry.resolved.slice(5)));
      const absolute = containedPath(root, path, fs);
      if (!path.endsWith('.tgz') || !existsSync(absolute) || !lstatSync(absolute).isFile()) {
        throw new Error('Local dependency must be an existing contained .tgz archive.');
      }
      assets.add(path);
    } else {
      const url = new URL(entry.resolved);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Only credential-free HTTPS registry archives or contained local tarballs are supported.');
      }
    }
  }
  const hash = createHash('sha256');
  for (const path of [...assets].sort()) {
    if (!tracked.has(path)) throw new Error('Dependency manifest, lock and local archives must be committed candidate assets.');
    hash.update(path).update('\0').update(readFileSync(containedPath(root, path, fs))).update('\0');
  }
  return {
    command: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    fingerprint: hash.digest('hex'), timeoutMs: 120_000,
  };
}
