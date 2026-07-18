// Intelligent Provider Router — Slice 5: the active execution-policy preference.
//
// A bounded per-workspace PREFERENCE stored in the extension memento. It is NOT
// enforcement authority — the server resolves the requested policy to an effective
// one and enforces routing/consent/privacy/budget. The extension never treats this
// value as permission to bypass local-first or any server gate.
//
// © MigraTeck LLC.

/** Minimal memento surface (matches vscode.Memento) so this is unit-testable. */
export interface PolicyMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

const KEY = 'migrapilot.executionPolicy';
export const KNOWN_POLICIES = ['auto', 'local-first', 'local-only', 'cloud-first', 'best-quality', 'lowest-cost', 'privacy-first', 'custom'] as const;
export type KnownPolicy = (typeof KNOWN_POLICIES)[number];

export class ExecutionPolicyState {
  constructor(private readonly memento: PolicyMemento, private readonly serverDefault: () => string = () => 'auto') {}

  /** The stored preference, or the server default when unset/unknown (never a
   * hard-coded local assumption). */
  get(): string {
    const stored = this.memento.get<string>(KEY, '');
    return stored && (KNOWN_POLICIES as readonly string[]).includes(stored) ? stored : this.serverDefault();
  }

  async set(policy: string): Promise<void> {
    if (!(KNOWN_POLICIES as readonly string[]).includes(policy)) return; // ignore unknown values
    await this.memento.update(KEY, policy);
  }
}
