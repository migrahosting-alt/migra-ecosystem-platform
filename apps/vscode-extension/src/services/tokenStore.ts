// Token storage abstraction (see docs/pilot-api-integration-plan.md §2).
//
// The JWT lives in VS Code SecretStorage in production; this interface keeps the
// storage mechanism injectable so the router/config logic — and the storage
// contract itself — are unit-testable without a live SecretStorage. The vscode
// adapter (VscodeSecretTokenStore) lives in pilotConfigVscode.ts.
//
// The token value is never logged, echoed, or serialized anywhere in this layer.

export interface TokenStore {
  get(): Promise<string | undefined>;
  set(token: string): Promise<void>;
  delete(): Promise<void>;
}

/** In-memory TokenStore for tests. Not used in production. */
export class InMemoryTokenStore implements TokenStore {
  private value: string | undefined;

  async get(): Promise<string | undefined> {
    return this.value;
  }

  async set(token: string): Promise<void> {
    this.value = token;
  }

  async delete(): Promise<void> {
    this.value = undefined;
  }
}
