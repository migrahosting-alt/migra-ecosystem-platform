/**
 * MigraPilot — the pure core of Diagnose Failure.
 *
 * Separated from the command shell because everything here is decidable without an editor:
 * which diagnostics count as evidence, how far the excerpt reaches, and what the prompt
 * says. Keeping it out of the `vscode` import lets it be tested directly rather than only
 * through a launched VS Code, which is the difference between checking the bounds and
 * hoping they hold.
 */

import type { GovernedWorkflowId } from '@migrapilot/protocol';

/** The workflow this command speaks for. Named once so the map is the single source. */
export const DIAGNOSE_WORKFLOW: GovernedWorkflowId = 'diagnose.failure';

/** Evidence gathered from the editor — read-only, and bounded so a huge file cannot flood the prompt. */
export interface FailureEvidence {
  file: string;
  language: string;
  diagnostics: Array<{ line: number; severity: string; message: string; source?: string }>;
  excerpt: string;
}

const SEVERITY: Record<number, string> = { 0: 'error', 1: 'warning', 2: 'information', 3: 'hint' };
const MAX_DIAGNOSTICS = 12;
const MAX_EXCERPT_LINES = 120;

/**
 * Collect what the model needs to explain a failure.
 *
 * Errors and warnings only: hints and information are editor noise and would push the real
 * failure out of a bounded list.
 */
export function collectFailureEvidence(
  document: { fileName: string; languageId: string; lineAt(line: number): { text: string }; lineCount: number },
  diagnostics: readonly { range: { start: { line: number } }; severity?: number; message: string; source?: string }[],
): FailureEvidence {
  const relevant = diagnostics
    .filter((d) => (d.severity ?? 0) <= 1)
    .slice(0, MAX_DIAGNOSTICS)
    .map((d) => ({
      line: d.range.start.line + 1,
      severity: SEVERITY[d.severity ?? 0] ?? 'error',
      message: d.message,
      ...(d.source ? { source: d.source } : {}),
    }));

  // A window around the first problem, not the whole file — the diagnosis needs the failing
  // region, and an unbounded excerpt would crowd out the diagnostics themselves.
  const focus = relevant[0]?.line ?? 1;
  const start = Math.max(0, focus - 1 - Math.floor(MAX_EXCERPT_LINES / 2));
  const end = Math.min(document.lineCount, start + MAX_EXCERPT_LINES);
  const lines: string[] = [];
  for (let i = start; i < end; i += 1) lines.push(`${i + 1}: ${document.lineAt(i).text}`);

  return { file: document.fileName, language: document.languageId, diagnostics: relevant, excerpt: lines.join('\n') };
}

/** The prompt. Asks for an explanation and a proposal — never for an edit to be applied. */
export function buildDiagnosisPrompt(evidence: FailureEvidence): string {
  return [
    'Diagnose this failure. Identify the root cause, name the affected symbol, and propose a minimal fix.',
    'Do not invent APIs or files that are not shown. If the evidence is insufficient, say so.',
    '',
    `File: ${evidence.file} (${evidence.language})`,
    '',
    'Diagnostics:',
    ...evidence.diagnostics.map((d) => `  line ${d.line} [${d.severity}${d.source ? ` ${d.source}` : ''}] ${d.message}`),
    '',
    'Source:',
    evidence.excerpt,
  ].join('\n');
}

