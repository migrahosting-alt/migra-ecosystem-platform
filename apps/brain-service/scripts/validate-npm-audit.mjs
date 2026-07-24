#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const exceptionsPath = path.join(root, 'apps/brain-service/security/npm-audit-exceptions.json');
const exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8')).exceptions;

function runAudit(args) {
  const result = spawnSync('npm', ['audit', '--json', ...args], { cwd: root, encoding: 'utf8' });
  const stdout = result.stdout.trim() || '{}';
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm audit did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runJson(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return JSON.parse(result.stdout.trim() || '{}');
}

const now = new Date(process.env.MIGRAPILOT_AUDIT_NOW ?? new Date().toISOString());
const full = runAudit([]);
const production = runAudit(['--omit=dev']);
if ((production.metadata?.vulnerabilities?.total ?? 0) !== 0) {
  throw new Error('Production dependency audit is not clean.');
}

if (exceptions.length !== 1) throw new Error('Expected exactly one Stage 2B npm audit exception.');
const exception = exceptions[0];
if (new Date(`${exception.reviewBy}T00:00:00Z`) < now) {
  throw new Error(`Audit exception ${exception.id} expired on ${exception.reviewBy}.`);
}

const vulnerabilities = full.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities).sort();
if (names.join(',') !== 'mocha,serialize-javascript') {
  throw new Error(`Unexpected full-audit vulnerability set: ${names.join(',') || '(none)'}.`);
}

const mocha = vulnerabilities.mocha;
const serialize = vulnerabilities['serialize-javascript'];
if (!mocha?.isDirect || mocha.severity !== 'moderate' || !mocha.via?.includes('serialize-javascript')) {
  throw new Error('The mocha advisory shape no longer matches the documented dev-only exception.');
}
if (serialize?.severity !== exception.severity) {
  throw new Error('serialize-javascript severity changed; review the exception.');
}
const advisoryIds = (serialize.via ?? []).filter((entry) => typeof entry === 'object').map((entry) => entry.source).sort();
const expectedIds = exception.advisories.map((entry) => entry.id).sort();
if (JSON.stringify(advisoryIds) !== JSON.stringify(expectedIds)) {
  throw new Error(`serialize-javascript advisory set changed: ${advisoryIds.join(',')}`);
}
if ((serialize.nodes ?? []).join(',') !== 'node_modules/serialize-javascript') {
  throw new Error('serialize-javascript appeared in an unexpected install location.');
}
if ((serialize.effects ?? []).join(',') !== 'mocha') {
  throw new Error('serialize-javascript now affects a package other than mocha.');
}

const prodTree = runJson('npm', ['ls', 'serialize-javascript', '--omit=dev', '--json']);
if (prodTree.dependencies?.['serialize-javascript']) {
  throw new Error('serialize-javascript is reachable from the production dependency tree.');
}

console.log(JSON.stringify({
  ok: true,
  productionVulnerabilities: production.metadata?.vulnerabilities ?? {},
  fullVulnerabilities: full.metadata?.vulnerabilities ?? {},
  exception: exception.id,
}, null, 2));
