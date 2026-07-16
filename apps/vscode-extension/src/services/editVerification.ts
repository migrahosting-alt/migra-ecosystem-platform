// Workspace read-back verification for edit/fix flows (P3 invariant: verify the
// resulting workspace state, don't trust a success response). vscode-free and
// injectable so it is unit-testable; callers bind `readFile` to the real FS.

export interface AppliedChangeExpectation {
  path: string;
  /** Text that must be present in the file after applying the edit. */
  expectedSubstring: string;
}

export interface VerificationResult {
  verified: boolean;
  failures: string[];
}

export async function verifyEditsApplied(
  changes: readonly AppliedChangeExpectation[],
  readFile: (relPath: string) => Promise<string>,
): Promise<VerificationResult> {
  const failures: string[] = [];
  for (const change of changes) {
    let content: string;
    try {
      content = await readFile(change.path);
    } catch {
      failures.push(change.path);
      continue;
    }
    if (!content.includes(change.expectedSubstring)) {
      failures.push(change.path);
    }
  }
  return { verified: failures.length === 0, failures };
}
