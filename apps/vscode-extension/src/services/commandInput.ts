/**
 * Parse what a person typed into an argv ARRAY. No shell is involved anywhere in this
 * lane, so this deliberately does not emulate one.
 *
 * The important decision is what to do with `npm test && echo done`. The Brain would
 * happily run it — as `npm` with the literal arguments `test`, `&&`, `echo`, `done` —
 * which is safe but silently not what the person meant. Passing it through would teach
 * the user that chaining "works" until the day they rely on it. So metacharacters are
 * REFUSED here with an explanation, rather than quietly reinterpreted.
 *
 * Quoting is supported because argument values legitimately contain spaces
 * (`npm test -- --testNamePattern "my case"`); that is grouping, not shell semantics.
 */

/** Characters that only mean something to a shell. Their presence implies an intent we cannot honour. */
const SHELL_METACHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['&&', 'command chaining'],
  ['||', 'command chaining'],
  ['|', 'pipes'],
  [';', 'command sequencing'],
  ['>', 'output redirection'],
  ['<', 'input redirection'],
  ['`', 'command substitution'],
  ['$(', 'command substitution'],
  ['&', 'background execution'],
];

export type CommandInputResult =
  | { ok: true; argv: string[] }
  | { ok: false; reason: string };

export function parseCommandInput(raw: string): CommandInputResult {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: 'No command entered.' };
  if (text.includes('\n')) {
    return { ok: false, reason: 'One command per run — newlines are not supported in this lane.' };
  }
  for (const [token, meaning] of SHELL_METACHARACTERS) {
    if (text.includes(token)) {
      return {
        ok: false,
        reason: `"${token}" (${meaning}) needs a shell, and this lane runs one bounded command with no shell. Run the parts separately.`,
      };
    }
  }

  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let sawQuote = false;
  for (const char of text) {
    if (quote !== null) {
      if (char === quote) { quote = null; continue; }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; sawQuote = true; continue; }
    if (char === ' ' || char === '\t') {
      if (current.length > 0 || sawQuote) { argv.push(current); current = ''; sawQuote = false; }
      continue;
    }
    current += char;
  }
  if (quote !== null) return { ok: false, reason: 'Unbalanced quote in the command.' };
  if (current.length > 0 || sawQuote) argv.push(current);
  if (argv.length === 0) return { ok: false, reason: 'No command entered.' };

  const program = argv[0]!;
  if (program.includes('/') || program.includes('\\')) {
    return {
      ok: false,
      reason: `"${program}" looks like a path. The program must be a bare name on the Brain's allowlist.`,
    };
  }
  return { ok: true, argv };
}

/** Render a completed run for the output channel. Truthful about every outcome. */
export function formatCommandResult(input: {
  argv: readonly string[];
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  redacted: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}): string {
  const lines: string[] = [];
  lines.push(`> ${input.argv.join(' ')}`);
  lines.push('');
  lines.push('Running in:');
  lines.push(input.cwd);
  lines.push('');
  lines.push(
    input.timedOut
      ? `Exit: TIMED OUT after ${input.durationMs} ms (process killed)`
      : `Exit: ${input.exitCode ?? 'unknown'}  (${input.durationMs} ms)`,
  );
  if (input.truncated) lines.push('Output was truncated at the server cap (24 KiB per stream).');
  if (input.redacted) lines.push('Secret-looking values were redacted before the output left the Brain.');
  if (input.stdout.trim().length > 0) {
    lines.push('', 'stdout:', input.stdout.replace(/\s+$/, ''));
  }
  if (input.stderr.trim().length > 0) {
    lines.push('', 'stderr:', input.stderr.replace(/\s+$/, ''));
  }
  if (input.stdout.trim().length === 0 && input.stderr.trim().length === 0) {
    lines.push('', '(no output)');
  }
  return lines.join('\n');
}
