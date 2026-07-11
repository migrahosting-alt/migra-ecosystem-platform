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

/* ══════════════════════════════════════════════════════════════
   In-memory workspace filesystem + WorkspaceEdit (Phase C).
   Backs the REAL applyEngine so its WorkspaceEdit/fs code path runs unchanged.
   ══════════════════════════════════════════════════════════════ */

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;

export class FileSystemError extends Error {
  code: string;
  constructor(message: string, code = "FileNotFound") { super(message); this.code = code; }
  static FileNotFound(msg?: string) { return new FileSystemError(msg ?? "file not found", "FileNotFound"); }
}

interface FsEntry { content: Uint8Array; symlinkTarget?: string }
const WS_ROOT = "/workspace/demo";
const fsStore = new Map<string, FsEntry>();  // key: absolute fsPath
const failApplyPaths = new Set<string>();    // rel paths whose applyEdit fails
let dirtyDocs: Array<{ uri: { fsPath: string }; fileName: string; isDirty: boolean }> = [];
let trusted = true;
let folders: Array<{ uri: any; name: string; index: number }> = [{ uri: { fsPath: WS_ROOT, path: WS_ROOT, toString: () => WS_ROOT }, name: "demo", index: 0 }];

const te = new TextEncoder();
const td = new TextDecoder();
const absOf = (rel: string) => `${WS_ROOT}/${rel.replace(/^\/+/, "")}`;
const relOf = (abs: string) => abs.replace(`${WS_ROOT}/`, "");
function fsPathOf(uri: any): string { return typeof uri === "string" ? uri : uri?.fsPath ?? String(uri); }

/** Test helpers (prefixed __) — reset/seed the in-memory workspace. */
export function __resetFs(): void {
  fsStore.clear(); failApplyPaths.clear(); dirtyDocs = []; trusted = true;
  folders = [{ uri: { fsPath: WS_ROOT, path: WS_ROOT, toString: () => WS_ROOT }, name: "demo", index: 0 }];
}
export function __seedFile(rel: string, content: string): void { fsStore.set(absOf(rel), { content: te.encode(content) }); }
export function __seedSymlink(rel: string, target: string): void { fsStore.set(absOf(rel), { content: te.encode(""), symlinkTarget: target }); }
export function __markDirty(rel: string): void { dirtyDocs.push({ uri: { fsPath: absOf(rel) }, fileName: absOf(rel), isDirty: true }); }
export function __failApplyFor(rel: string): void { failApplyPaths.add(rel); }
export function __setTrusted(v: boolean): void { trusted = v; }
export function __setNoWorkspace(): void { folders = []; }
export function __readFile(rel: string): string | undefined { const e = fsStore.get(absOf(rel)); return e ? td.decode(e.content) : undefined; }
export function __exists(rel: string): boolean { return fsStore.has(absOf(rel)); }
export const __WS_ROOT = WS_ROOT;

export class WorkspaceEdit {
  public ops: any[] = [];
  createFile(uri: any, opts?: { contents?: Uint8Array; overwrite?: boolean; ignoreIfExists?: boolean }) { this.ops.push({ kind: "create", uri, opts: opts ?? {} }); }
  deleteFile(uri: any, opts?: { ignoreIfNotExists?: boolean; recursive?: boolean }) { this.ops.push({ kind: "delete", uri, opts: opts ?? {} }); }
  renameFile(from: any, to: any, opts?: { overwrite?: boolean }) { this.ops.push({ kind: "rename", from, to, opts: opts ?? {} }); }
  replace(uri: any, _range: any, text: string) { this.ops.push({ kind: "replace", uri, text }); }
  insert(uri: any, _pos: any, text: string) { this.ops.push({ kind: "replace", uri, text }); }
}

function applyEditImpl(edit: WorkspaceEdit): boolean {
  // Injected failure: any touched path in failApplyPaths aborts atomically.
  for (const op of edit.ops) {
    const paths = op.kind === "rename" ? [op.from, op.to] : [op.uri];
    for (const u of paths) if (failApplyPaths.has(relOf(fsPathOf(u)))) return false;
  }
  // Validate all ops, then execute (atomic per call).
  for (const op of edit.ops) {
    if (op.kind === "create") {
      const p = fsPathOf(op.uri); const exists = fsStore.has(p);
      if (exists && !op.opts.overwrite && !op.opts.ignoreIfExists) return false;
    } else if (op.kind === "delete") {
      const p = fsPathOf(op.uri); if (!fsStore.has(p) && !op.opts.ignoreIfNotExists) return false;
    } else if (op.kind === "rename") {
      const from = fsPathOf(op.from); const to = fsPathOf(op.to);
      if (!fsStore.has(from)) return false;
      if (fsStore.has(to) && !op.opts.overwrite) return false;
    }
  }
  for (const op of edit.ops) {
    if (op.kind === "create") {
      const p = fsPathOf(op.uri);
      if (fsStore.has(p) && op.opts.ignoreIfExists && !op.opts.overwrite) continue;
      fsStore.set(p, { content: op.opts.contents ?? te.encode("") });
    } else if (op.kind === "delete") {
      fsStore.delete(fsPathOf(op.uri));
    } else if (op.kind === "rename") {
      const from = fsPathOf(op.from); const to = fsPathOf(op.to);
      const e = fsStore.get(from)!; fsStore.delete(from); fsStore.set(to, e);
    } else if (op.kind === "replace") {
      fsStore.set(fsPathOf(op.uri), { content: te.encode(op.text) });
    }
  }
  return true;
}

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
  get isTrusted(): boolean { return trusted; },
  get workspaceFolders(): any[] | undefined { return folders.length ? folders : undefined; },
  getWorkspaceFolder(uri: any) { const p = fsPathOf(uri); return folders.find((f) => p.startsWith(f.uri.fsPath)); },
  get textDocuments(): any[] { return dirtyDocs; },
  applyEdit(edit: any): Promise<boolean> { return Promise.resolve(applyEditImpl(edit)); },
  registerTextDocumentContentProvider(_scheme: string, _provider: any) { return { dispose() {} }; },
  fs: {
    async readFile(uri: any): Promise<Uint8Array> {
      const e = fsStore.get(fsPathOf(uri));
      if (!e) throw FileSystemError.FileNotFound(fsPathOf(uri));
      return e.content;
    },
    async stat(uri: any): Promise<{ type: number; size: number; ctime: number; mtime: number }> {
      const e = fsStore.get(fsPathOf(uri));
      if (!e) throw FileSystemError.FileNotFound(fsPathOf(uri));
      const type = e.symlinkTarget ? (FileType.File | FileType.SymbolicLink) : FileType.File;
      return { type, size: e.content.length, ctime: 0, mtime: 0 };
    },
    async writeFile(uri: any, content: Uint8Array): Promise<void> { fsStore.set(fsPathOf(uri), { content }); },
    async delete(uri: any): Promise<void> { fsStore.delete(fsPathOf(uri)); },
    async rename(from: any, to: any): Promise<void> { const e = fsStore.get(fsPathOf(from)); if (e) { fsStore.delete(fsPathOf(from)); fsStore.set(fsPathOf(to), e); } },
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
  WorkspaceEdit,
  FileType,
  FileSystemError,
};
