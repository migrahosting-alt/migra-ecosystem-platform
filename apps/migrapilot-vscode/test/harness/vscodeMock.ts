/**
 * Faithful in-memory mock of the slice of the `vscode` API that the MigraPilot
 * extension actually uses. Loaded via a vitest alias for `vscode`, so the real
 * production code under src/ runs unchanged. Config defaults are read from the
 * real package.json contributes.configuration block, so tests observe exactly
 * the defaults VS Code would apply (e.g. backend = "pilot-api").
 */
import * as fs from "fs";
import * as path from "path";

// ── configuration store (seeded from package.json defaults) ──
function loadConfigDefaults(): Record<string, unknown> {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const props = pkg?.contributes?.configuration?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries<any>(props)) {
    if (spec && "default" in spec) out[key] = spec.default;
  }
  return out;
}

const configDefaults = loadConfigDefaults();
let configOverrides: Record<string, unknown> = {};

/** Test helper: override a `migrapilot.*` setting for the current test. */
export function __setConfig(overrides: Record<string, unknown>): void {
  configOverrides = { ...configOverrides, ...overrides };
}
/** Test helper: reset all config overrides back to package.json defaults. */
export function __resetConfig(): void {
  configOverrides = {};
}

export const workspace = {
  name: "test-workspace" as string | undefined,
  getConfiguration(section: string) {
    return {
      get<T>(key: string, def?: T): T | undefined {
        const full = `${section}.${key}`;
        if (full in configOverrides) return configOverrides[full] as T;
        if (full in configDefaults) return configDefaults[full] as T;
        return def;
      },
    };
  },
  asRelativePath(uri: any, _includeWorkspace?: boolean): string {
    const p = typeof uri === "string" ? uri : uri?.fsPath ?? uri?.path ?? String(uri);
    return String(p).replace(/^.*[\\/]workspace[\\/]/, "");
  },
  async openTextDocument(_uri: any) { return { getText: () => "" }; },
  async findFiles(_a: any, _b?: any, _c?: number) { return []; },
  fs: {
    async readFile(_uri: any): Promise<Uint8Array> { return new Uint8Array(); },
    async stat(_uri: any): Promise<{ size: number }> { return { size: 0 }; },
  },
};

export const window: any = {
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: (_cb: any) => ({ dispose() {} }),
  onDidChangeTextEditorSelection: (_cb: any) => ({ dispose() {} }),
  createStatusBarItem: () => ({ text: "", tooltip: "", command: "", show() {}, hide() {}, dispose() {} }),
  registerWebviewViewProvider: () => ({ dispose() {} }),
  showQuickPick: async () => undefined,
  showOpenDialog: async () => undefined,
  showWarningMessage: (..._a: any[]) => Promise.resolve(undefined),
  showInformationMessage: (..._a: any[]) => Promise.resolve(undefined),
  showErrorMessage: (..._a: any[]) => Promise.resolve(undefined),
};

export const StatusBarAlignment = { Left: 1, Right: 2 };

export const commands = {
  _registered: new Map<string, (...args: any[]) => any>(),
  registerCommand(id: string, cb: (...args: any[]) => any) {
    if (this._registered.has(id)) {
      throw new Error(`command already registered: ${id}`);
    }
    this._registered.set(id, cb);
    return { dispose: () => this._registered.delete(id) };
  },
  async executeCommand(id: string, ...args: any[]) {
    const cb = this._registered.get(id);
    return cb ? cb(...args) : undefined;
  },
};

export const env = { openExternal: async (_uri: any) => true };

export const Uri = {
  parse: (s: string) => ({ toString: () => s, fsPath: s, path: s }),
  file: (p: string) => ({ fsPath: p, path: p, toString: () => p }),
  joinPath: (base: any, ...parts: string[]) => ({ fsPath: [base?.fsPath ?? "", ...parts].join("/"), path: [base?.path ?? "", ...parts].join("/") }),
};

// Position/Selection/Range primitives used by ContextCollector fixtures.
export class Position {
  constructor(public line: number, public character: number) {}
}
export class Selection {
  public start: Position;
  public end: Position;
  constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine, endChar);
  }
  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

export default {
  workspace,
  window,
  commands,
  env,
  Uri,
  StatusBarAlignment,
  Position,
  Selection,
};
