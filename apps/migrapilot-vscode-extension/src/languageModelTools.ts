import * as cp from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFile = promisify(cp.execFile);

type ToolInput = Record<string, unknown>;
type RunningDevServer = {
  id: string;
  command: string;
  cwd: string;
  startedAt: string;
  process: cp.ChildProcess;
  output: string;
  url?: string;
};

const devServers = new Map<string, RunningDevServer>();

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function jsonResult(value: unknown): vscode.LanguageModelToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

function firstWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function workspaceRoot(): string {
  const folder = firstWorkspaceFolder();
  if (!folder) throw new Error("No workspace folder is open.");
  return folder.uri.fsPath;
}

function workspaceUri(relPath: string): vscode.Uri {
  const folder = firstWorkspaceFolder();
  if (!folder) throw new Error("No workspace folder is open.");
  return vscode.Uri.joinPath(folder.uri, relPath.replace(/^\/+/, ""));
}

async function readTextFile(relPath: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(workspaceUri(relPath));
  return new TextDecoder().decode(bytes);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}

async function runGit(args: string[], cwd = workspaceRoot()): Promise<string> {
  const { stdout, stderr } = await execFile("git", args, {
    cwd,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  return truncate([stdout, stderr].filter(Boolean).join("\n"), 30_000);
}

function safeRelativePath(relPath: string): string {
  const normalized = relPath.replace(/^\/+/, "");
  const root = workspaceRoot();
  const abs = path.resolve(root, normalized);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return normalized;
}

async function writeTextFile(relPath: string, content: string): Promise<void> {
  const normalized = safeRelativePath(relPath);
  const uri = workspaceUri(normalized);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
}

function detectUrl(text: string): string | undefined {
  return text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s]*/i)?.[0]?.replace("0.0.0.0", "127.0.0.1");
}

function trimServerOutput(text: string): string {
  return text.length > 20_000 ? text.slice(-20_000) : text;
}

class SearchWorkspaceTool implements vscode.LanguageModelTool<{ query: string; include?: string; maxResults?: number }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ query: string; include?: string; maxResults?: number }>): Promise<vscode.LanguageModelToolResult> {
    const query = options.input.query.trim();
    const include = options.input.include?.trim() || "**/*";
    const maxResults = Math.min(Math.max(options.input.maxResults ?? 50, 1), 200);
    const root = workspaceRoot();
    const matches: Array<{ file: string; line: number; text: string }> = [];

    try {
      const { stdout } = await execFile("rg", ["--json", "--max-count", String(maxResults), "--glob", include, "--glob", "!**/node_modules/**", "--glob", "!**/.git/**", "--glob", "!**/.next/**", "--glob", "!**/dist/**", "--", query, root], {
        cwd: root,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      });
      for (const line of stdout.split("\n").filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.type !== "match") continue;
        matches.push({
          file: vscode.workspace.asRelativePath(event.data.path.text, false),
          line: event.data.line_number,
          text: String(event.data.lines.text ?? "").trim().slice(0, 300),
        });
        if (matches.length >= maxResults) break;
      }
    } catch (error: any) {
      if (error?.code !== 1) throw error;
    }

    return jsonResult({ query, include, matches, count: matches.length });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ query: string }>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Searching workspace for "${options.input.query}"` };
  }
}

class ListFilesTool implements vscode.LanguageModelTool<{ include?: string; exclude?: string; maxResults?: number }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ include?: string; exclude?: string; maxResults?: number }>): Promise<vscode.LanguageModelToolResult> {
    const include = options.input.include?.trim() || "**/*";
    const exclude = options.input.exclude?.trim() || "**/{node_modules,.git,.next,dist,build,coverage,backups,uploads,test-results}/**";
    const maxResults = Math.min(Math.max(options.input.maxResults ?? 200, 1), 1000);
    const files = await vscode.workspace.findFiles(include, exclude, maxResults);
    return jsonResult({ include, exclude, files: files.map(relativePath), count: files.length });
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: "Listing workspace files" };
  }
}

class ReadFileTool implements vscode.LanguageModelTool<{ path: string; startLine?: number; endLine?: number; maxChars?: number }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; startLine?: number; endLine?: number; maxChars?: number }>): Promise<vscode.LanguageModelToolResult> {
    const path = options.input.path;
    const content = await readTextFile(path);
    const lines = content.split("\n");
    const start = Math.max((options.input.startLine ?? 1) - 1, 0);
    const end = Math.min(options.input.endLine ?? lines.length, lines.length);
    const maxChars = Math.min(Math.max(options.input.maxChars ?? 20_000, 1000), 80_000);
    return jsonResult({
      path,
      startLine: start + 1,
      endLine: end,
      totalLines: lines.length,
      content: truncate(lines.slice(start, end).join("\n"), maxChars),
    });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string }>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Reading ${options.input.path}` };
  }
}

class DiagnosticsTool implements vscode.LanguageModelTool<{ path?: string }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path?: string }>): Promise<vscode.LanguageModelToolResult> {
    const target = options.input.path?.trim();
    const diagnostics = target
      ? [[workspaceUri(target), vscode.languages.getDiagnostics(workspaceUri(target))] as const]
      : vscode.languages.getDiagnostics();
    return jsonResult({
      diagnostics: diagnostics
        .filter(([, items]) => items.length > 0)
        .map(([uri, items]) => ({
          file: relativePath(uri),
          items: items.slice(0, 50).map((item) => ({
            severity: vscode.DiagnosticSeverity[item.severity],
            message: item.message,
            source: item.source,
            line: item.range.start.line + 1,
            character: item.range.start.character + 1,
          })),
        })),
    });
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: "Reading editor diagnostics" };
  }
}

class GitDiffTool implements vscode.LanguageModelTool<{ path?: string; staged?: boolean; maxChars?: number }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path?: string; staged?: boolean; maxChars?: number }>): Promise<vscode.LanguageModelToolResult> {
    const args = ["diff"];
    if (options.input.staged) args.push("--staged");
    if (options.input.path) args.push("--", options.input.path);
    const diff = await runGit(args);
    return jsonResult({ path: options.input.path ?? null, staged: Boolean(options.input.staged), diff: truncate(diff, options.input.maxChars ?? 40_000) });
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: "Reading git diff" };
  }
}

class RunCommandTool implements vscode.LanguageModelTool<{ command: string; cwd?: string; timeoutMs?: number; maxChars?: number }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ command: string; cwd?: string; timeoutMs?: number; maxChars?: number }>): Promise<vscode.LanguageModelToolResult> {
    const command = options.input.command.trim();
    const cwd = options.input.cwd ? workspaceUri(options.input.cwd).fsPath : workspaceRoot();
    const timeout = Math.min(Math.max(options.input.timeoutMs ?? 60_000, 1000), 300_000);
    const { stdout, stderr } = await execFile("bash", ["-lc", command], {
      cwd,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    }).catch((error: any) => ({
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? error?.message ?? String(error),
    }));
    return jsonResult({ command, cwd, stdout: truncate(stdout, options.input.maxChars ?? 30_000), stderr: truncate(stderr, options.input.maxChars ?? 30_000) });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ command: string; cwd?: string }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Running ${options.input.command}`,
      confirmationMessages: {
        title: "Run workspace command?",
        message: new vscode.MarkdownString(`MigraPilot wants to run:\n\n\`\`\`sh\n${options.input.command}\n\`\`\``),
      },
    };
  }
}

class ReplaceInFileTool implements vscode.LanguageModelTool<{ path: string; oldText: string; newText: string }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; oldText: string; newText: string }>): Promise<vscode.LanguageModelToolResult> {
    const path = options.input.path;
    const oldText = options.input.oldText;
    const newText = options.input.newText;
    const uri = workspaceUri(path);
    const current = await readTextFile(path);
    if (!current.includes(oldText)) {
      throw new Error(`Target text was not found in ${path}`);
    }
    const updated = current.replace(oldText, newText);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
    return jsonResult({ path, replaced: true, oldLength: oldText.length, newLength: newText.length });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; oldText: string; newText: string }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Editing ${options.input.path}`,
      confirmationMessages: {
        title: "Apply file edit?",
        message: new vscode.MarkdownString(`MigraPilot wants to replace ${options.input.oldText.length} chars in \`${options.input.path}\`.`),
      },
    };
  }
}

class CreateFileTool implements vscode.LanguageModelTool<{ path: string; content: string; overwrite?: boolean }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; content: string; overwrite?: boolean }>): Promise<vscode.LanguageModelToolResult> {
    const uri = workspaceUri(options.input.path);
    if (!options.input.overwrite) {
      try {
        await vscode.workspace.fs.stat(uri);
        throw new Error(`File already exists: ${options.input.path}`);
      } catch (error: any) {
        if (!/File already exists/.test(error?.message ?? "")) {
          // Missing file is expected.
        } else {
          throw error;
        }
      }
    }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(options.input.content));
    return jsonResult({ path: options.input.path, created: true, bytes: options.input.content.length });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; content: string; overwrite?: boolean }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Creating ${options.input.path}`,
      confirmationMessages: {
        title: options.input.overwrite ? "Overwrite file?" : "Create file?",
        message: new vscode.MarkdownString(`MigraPilot wants to write \`${options.input.path}\` (${options.input.content.length} chars).`),
      },
    };
  }
}

class BatchWriteFilesTool implements vscode.LanguageModelTool<{ files: Array<{ path: string; content: string; overwrite?: boolean }> }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ files: Array<{ path: string; content: string; overwrite?: boolean }> }>): Promise<vscode.LanguageModelToolResult> {
    const written: Array<{ path: string; bytes: number }> = [];
    for (const file of options.input.files) {
      const relPath = safeRelativePath(file.path);
      if (!file.overwrite) {
        try {
          await vscode.workspace.fs.stat(workspaceUri(relPath));
          throw new Error(`File already exists: ${relPath}`);
        } catch (error: any) {
          if (/File already exists/.test(error?.message ?? "")) throw error;
        }
      }
      await writeTextFile(relPath, file.content);
      written.push({ path: relPath, bytes: file.content.length });
    }
    return jsonResult({ written, count: written.length });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ files: Array<{ path: string; content: string }> }>): vscode.PreparedToolInvocation {
    const files = options.input.files ?? [];
    return {
      invocationMessage: `Writing ${files.length} file${files.length === 1 ? "" : "s"}`,
      confirmationMessages: {
        title: "Write multiple files?",
        message: new vscode.MarkdownString(`MigraPilot wants to write ${files.length} file${files.length === 1 ? "" : "s"}:\n\n${files.map((file) => `- \`${file.path}\``).join("\n")}`),
      },
    };
  }
}

class MoveFileTool implements vscode.LanguageModelTool<{ from: string; to: string; overwrite?: boolean }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ from: string; to: string; overwrite?: boolean }>): Promise<vscode.LanguageModelToolResult> {
    const from = safeRelativePath(options.input.from);
    const to = safeRelativePath(options.input.to);
    await vscode.workspace.fs.rename(workspaceUri(from), workspaceUri(to), { overwrite: Boolean(options.input.overwrite) });
    return jsonResult({ from, to, moved: true });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ from: string; to: string }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Moving ${options.input.from}`,
      confirmationMessages: {
        title: "Move file?",
        message: new vscode.MarkdownString(`MigraPilot wants to move \`${options.input.from}\` to \`${options.input.to}\`.`),
      },
    };
  }
}

class DeleteFileTool implements vscode.LanguageModelTool<{ path: string; recursive?: boolean }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; recursive?: boolean }>): Promise<vscode.LanguageModelToolResult> {
    const target = safeRelativePath(options.input.path);
    await vscode.workspace.fs.delete(workspaceUri(target), { recursive: Boolean(options.input.recursive), useTrash: true });
    return jsonResult({ path: target, deleted: true, trash: true });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; recursive?: boolean }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Deleting ${options.input.path}`,
      confirmationMessages: {
        title: "Delete file?",
        message: new vscode.MarkdownString(`MigraPilot wants to move \`${options.input.path}\` to trash.`),
      },
    };
  }
}

class ApplyPatchTool implements vscode.LanguageModelTool<{ patch: string; checkOnly?: boolean }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ patch: string; checkOnly?: boolean }>): Promise<vscode.LanguageModelToolResult> {
    const tmpPath = path.join(os.tmpdir(), `migrapilot-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
    await fs.writeFile(tmpPath, options.input.patch, "utf8");
    const args = ["apply"];
    if (options.input.checkOnly) args.push("--check");
    args.push(tmpPath);
    try {
      const output = await runGit(args);
      return jsonResult({ applied: !options.input.checkOnly, checkOnly: Boolean(options.input.checkOnly), output });
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ patch: string; checkOnly?: boolean }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: options.input.checkOnly ? "Checking patch" : "Applying patch",
      confirmationMessages: options.input.checkOnly ? undefined : {
        title: "Apply patch?",
        message: new vscode.MarkdownString(`MigraPilot wants to apply a unified patch (${options.input.patch.length} chars).`),
      },
    };
  }
}

class ScaffoldWebsiteTool implements vscode.LanguageModelTool<{ path: string; name?: string; framework?: "vite-react-ts"; install?: boolean }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; name?: string; framework?: "vite-react-ts"; install?: boolean }>): Promise<vscode.LanguageModelToolResult> {
    const target = safeRelativePath(options.input.path);
    const name = options.input.name?.trim() || path.basename(target) || "migrapilot-site";
    const files = [
      {
        path: `${target}/package.json`,
        content: JSON.stringify({
          scripts: { dev: "vite --host 127.0.0.1", build: "tsc -b && vite build", preview: "vite preview --host 127.0.0.1" },
          dependencies: { "@vitejs/plugin-react": "latest", "vite": "latest", "typescript": "latest", "react": "latest", "react-dom": "latest", "lucide-react": "latest" },
          devDependencies: { "@types/react": "latest", "@types/react-dom": "latest" },
        }, null, 2) + "\n",
      },
      { path: `${target}/index.html`, content: `<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n` },
      { path: `${target}/tsconfig.json`, content: JSON.stringify({ compilerOptions: { target: "ES2020", useDefineForClassFields: true, lib: ["DOM", "DOM.Iterable", "ES2020"], allowJs: false, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, strict: true, forceConsistentCasingInFileNames: true, module: "ESNext", moduleResolution: "Node", resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: "react-jsx" }, include: ["src"], references: [] }, null, 2) + "\n" },
      { path: `${target}/src/main.tsx`, content: `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport { ArrowRight, Sparkles } from "lucide-react";\nimport "./styles.css";\n\nfunction App() {\n  return (\n    <main className="page-shell">\n      <section className="hero">\n        <div className="hero-copy">\n          <p className="eyebrow">Built with MigraPilot</p>\n          <h1>${name}</h1>\n          <p className="lede">A polished starter site ready for product copy, responsive sections, and real visual QA.</p>\n          <div className="actions">\n            <a href="#work">Explore <ArrowRight size={18} /></a>\n          </div>\n        </div>\n        <div className="visual" aria-label="Product preview"><Sparkles size={64} /></div>\n      </section>\n      <section id="work" className="grid">\n        {["Fast setup", "Responsive", "Ready to verify"].map((title) => <article key={title}><h2>{title}</h2><p>Replace this with domain-specific content and let MigraPilot iterate with screenshots.</p></article>)}\n      </section>\n    </main>\n  );\n}\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n` },
      { path: `${target}/src/styles.css`, content: `:root { color: #17202a; background: #f6f7fb; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n* { box-sizing: border-box; }\nbody { margin: 0; }\n.page-shell { min-height: 100vh; }\n.hero { min-height: 72vh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(280px, .9fr); gap: 48px; align-items: center; padding: clamp(32px, 6vw, 88px); }\n.eyebrow { color: #0f766e; font-weight: 700; text-transform: uppercase; font-size: 13px; }\nh1 { font-size: clamp(44px, 8vw, 92px); line-height: .95; margin: 0; letter-spacing: 0; }\n.lede { max-width: 640px; color: #46515f; font-size: 20px; line-height: 1.6; }\n.actions a { display: inline-flex; gap: 10px; align-items: center; color: white; background: #17202a; text-decoration: none; padding: 13px 18px; border-radius: 8px; font-weight: 700; }\n.visual { min-height: 360px; border-radius: 8px; display: grid; place-items: center; color: #0f766e; background: linear-gradient(135deg, #dff7f3, #f8d9c4); box-shadow: inset 0 0 0 1px rgba(23,32,42,.08); }\n.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #d9dee7; }\narticle { background: white; padding: 32px; min-height: 190px; }\narticle h2 { margin: 0 0 12px; font-size: 22px; }\narticle p { margin: 0; color: #5d6673; line-height: 1.55; }\n@media (max-width: 760px) { .hero { grid-template-columns: 1fr; padding: 28px; gap: 28px; } .visual { min-height: 240px; } .grid { grid-template-columns: 1fr; } }\n` },
    ];
    for (const file of files) await writeTextFile(file.path, file.content);
    let installOutput = "";
    if (options.input.install) {
      const { stdout, stderr } = await execFile("bash", ["-lc", "npm install"], {
        cwd: workspaceUri(target).fsPath,
        timeout: 300_000,
        maxBuffer: 2 * 1024 * 1024,
      }).catch((error: any) => ({
        stdout: error?.stdout ?? "",
        stderr: error?.stderr ?? error?.message ?? String(error),
      }));
      installOutput = truncate([stdout, stderr].filter(Boolean).join("\n"), 20_000);
    }
    return jsonResult({ scaffolded: target, framework: "vite-react-ts", files: files.map((file) => file.path), installRequested: Boolean(options.input.install), installOutput: typeof installOutput === "string" ? installOutput : undefined });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; install?: boolean }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Scaffolding website in ${options.input.path}`,
      confirmationMessages: {
        title: "Scaffold website?",
        message: new vscode.MarkdownString(`MigraPilot wants to create a Vite React site in \`${options.input.path}\`${options.input.install ? " and run npm install" : ""}.`),
      },
    };
  }
}

class StartDevServerTool implements vscode.LanguageModelTool<{ command?: string; cwd?: string; id?: string }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ command?: string; cwd?: string; id?: string }>): Promise<vscode.LanguageModelToolResult> {
    const command = options.input.command?.trim() || "npm run dev";
    const cwd = options.input.cwd ? workspaceUri(options.input.cwd).fsPath : workspaceRoot();
    const id = options.input.id?.trim() || `dev-${Date.now().toString(36)}`;
    const child = cp.spawn("bash", ["-lc", command], { cwd, env: process.env });
    const server: RunningDevServer = { id, command, cwd, startedAt: new Date().toISOString(), process: child, output: "" };
    const onData = (chunk: Buffer) => {
      server.output = trimServerOutput(server.output + chunk.toString("utf8"));
      server.url = server.url || detectUrl(server.output);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code, signal) => {
      server.output = trimServerOutput(`${server.output}\n[exited code=${code} signal=${signal}]`);
    });
    devServers.set(id, server);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return jsonResult({ id, command, cwd, url: server.url ?? null, output: truncate(server.output, 8000), running: child.exitCode == null });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ command?: string; cwd?: string }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: "Starting dev server",
      confirmationMessages: {
        title: "Start dev server?",
        message: new vscode.MarkdownString(`MigraPilot wants to run:\n\n\`\`\`sh\n${options.input.command || "npm run dev"}\n\`\`\``),
      },
    };
  }
}

class StopDevServerTool implements vscode.LanguageModelTool<{ id?: string }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ id?: string }>): Promise<vscode.LanguageModelToolResult> {
    const ids = options.input.id ? [options.input.id] : [...devServers.keys()];
    const stopped: string[] = [];
    for (const id of ids) {
      const server = devServers.get(id);
      if (!server) continue;
      server.process.kill("SIGTERM");
      devServers.delete(id);
      stopped.push(id);
    }
    return jsonResult({ stopped });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ id?: string }>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: "Stopping dev server",
      confirmationMessages: {
        title: "Stop dev server?",
        message: options.input.id ? `Stop ${options.input.id}?` : "Stop all MigraPilot-managed dev servers?",
      },
    };
  }
}

class ListDevServersTool implements vscode.LanguageModelTool<ToolInput> {
  async invoke(): Promise<vscode.LanguageModelToolResult> {
    return jsonResult({
      servers: [...devServers.values()].map((server) => ({
        id: server.id,
        command: server.command,
        cwd: server.cwd,
        startedAt: server.startedAt,
        running: server.process.exitCode == null,
        url: server.url ?? detectUrl(server.output) ?? null,
        output: truncate(server.output, 8000),
      })),
    });
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: "Reading dev server status" };
  }
}

class OpenPreviewTool implements vscode.LanguageModelTool<{ url: string; external?: boolean }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ url: string; external?: boolean }>): Promise<vscode.LanguageModelToolResult> {
    const uri = vscode.Uri.parse(options.input.url);
    if (options.input.external) {
      await vscode.env.openExternal(uri);
    } else {
      await vscode.commands.executeCommand("simpleBrowser.show", uri);
    }
    return jsonResult({ opened: options.input.url, external: Boolean(options.input.external) });
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ url: string }>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Opening preview ${options.input.url}` };
  }
}

class BrowserAuditTool implements vscode.LanguageModelTool<{ url: string; outDir?: string; waitMs?: number }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ url: string; outDir?: string; waitMs?: number }>): Promise<vscode.LanguageModelToolResult> {
    const outDir = safeRelativePath(options.input.outDir || ".migrapilot/screenshots");
    const absOutDir = workspaceUri(outDir).fsPath;
    await fs.mkdir(absOutDir, { recursive: true });
    const runnerDir = path.join(workspaceRoot(), ".migrapilot", "playwright-runner");
    await fs.mkdir(runnerDir, { recursive: true });
    await fs.writeFile(path.join(runnerDir, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2), "utf8");
    try {
      await fs.stat(path.join(runnerDir, "node_modules", "playwright", "package.json"));
    } catch {
      await execFile("npm", ["install", "--no-save", "playwright"], {
        cwd: runnerDir,
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      await execFile("npx", ["playwright", "install", "chromium"], {
        cwd: runnerDir,
        timeout: 300_000,
        maxBuffer: 2 * 1024 * 1024,
      }).catch(() => undefined);
    }
    const scriptPath = path.join(runnerDir, `audit-${Date.now()}.mjs`);
    const reportPath = path.join(absOutDir, `audit-${Date.now()}.json`);
    const script = `
import { chromium } from "playwright";
const url = ${JSON.stringify(options.input.url)};
const reportPath = ${JSON.stringify(reportPath)};
const outDir = ${JSON.stringify(absOutDir)};
const waitMs = ${JSON.stringify(Math.min(Math.max(options.input.waitMs ?? 1200, 0), 10000))};
const viewports = [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }];
const browser = await chromium.launch({ headless: true });
const reports = [];
for (const viewport of viewports) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => { if (["error", "warning"].includes(msg.type())) consoleErrors.push({ type: msg.type(), text: msg.text() }); });
  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch((error) => ({ error: String(error?.message || error) }));
  if (waitMs) await page.waitForTimeout(waitMs);
  const screenshot = outDir + "/" + viewport.name + ".png";
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > window.innerWidth + 2;
    const textOverflow = [...document.querySelectorAll("body *")].filter((el) => {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      return el.scrollWidth > el.clientWidth + 2 && el.textContent && el.textContent.trim().length > 0;
    }).slice(0, 25).map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 100), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    const links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).slice(0, 50);
    return { title: document.title, overflowX, scrollWidth: doc.scrollWidth, viewportWidth: window.innerWidth, textOverflow, links };
  }).catch((error) => ({ error: String(error?.message || error) }));
  reports.push({ viewport, status: "status" in response ? response.status() : null, navigationError: response.error || null, screenshot, consoleErrors, pageErrors, layout });
  await page.close();
}
await browser.close();
await import("node:fs/promises").then((fs) => fs.writeFile(reportPath, JSON.stringify({ url, reports }, null, 2)));
`;
    await fs.writeFile(scriptPath, script, "utf8");
    try {
      const { stdout, stderr } = await execFile(process.execPath, [scriptPath], {
        cwd: runnerDir,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      }).catch((error: any) => ({
        stdout: error?.stdout ?? "",
        stderr: error?.stderr ?? error?.message ?? String(error),
      }));
      const reportRaw = await fs.readFile(reportPath, "utf8").catch(() => "");
      return jsonResult({ url: options.input.url, reportPath: path.relative(workspaceRoot(), reportPath), stdout: truncate(stdout, 8000), stderr: truncate(stderr, 8000), report: reportRaw ? JSON.parse(reportRaw) : null });
    } finally {
      await fs.unlink(scriptPath).catch(() => undefined);
    }
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ url: string }>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Auditing ${options.input.url} in browser` };
  }
}

class WebsiteTaskTool implements vscode.LanguageModelTool<{ goal: string; projectPath?: string; url?: string }> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<{ goal: string; projectPath?: string; url?: string }>): Promise<vscode.LanguageModelToolResult> {
    const projectPath = options.input.projectPath || ".";
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceUri(projectPath), "{package.json,src/**/*,app/**/*,pages/**/*,index.html}"), "**/{node_modules,.git,.next,dist,build}/**", 300);
    const diagnostics = vscode.languages.getDiagnostics()
      .filter(([uri]) => relativePath(uri).startsWith(projectPath.replace(/^\.\//, "").replace(/\/?$/, "/")) || projectPath === ".")
      .flatMap(([uri, items]) => items.map((item) => ({ file: relativePath(uri), line: item.range.start.line + 1, severity: vscode.DiagnosticSeverity[item.severity], message: item.message })))
      .slice(0, 100);
    return jsonResult({
      goal: options.input.goal,
      projectPath,
      url: options.input.url ?? null,
      nextRecommendedLoop: [
        "Inspect package.json and relevant route/component/style files.",
        "Apply multi-file edits with migrapilot_batchWriteFiles, migrapilot_replaceInFile, or migrapilot_applyPatch.",
        "Run install/build/tests with migrapilot_runCommand.",
        "Start or reuse dev server with migrapilot_startDevServer.",
        "Open and audit with migrapilot_browserAudit across desktop/mobile.",
        "Fix reported console, layout, responsiveness, and build issues, then summarize changed files.",
      ],
      discoveredFiles: files.map(relativePath),
      diagnostics,
    });
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: "Preparing website build task context" };
  }
}

class ActiveContextTool implements vscode.LanguageModelTool<ToolInput> {
  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const editor = vscode.window.activeTextEditor;
    const selection = editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : "";
    const visibleFiles = vscode.window.visibleTextEditors.map((item) => relativePath(item.document.uri));
    return jsonResult({
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.name),
      activeFile: editor ? relativePath(editor.document.uri) : null,
      selection: truncate(selection, 20_000),
      visibleFiles,
    });
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: "Reading active editor context" };
  }
}

export function registerLanguageModelTools(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  if (!vscode.lm?.registerTool) {
    output.appendLine("[lm-tools] VS Code Language Model Tool API is unavailable in this VS Code build.");
    return;
  }

  const tools: Array<[string, vscode.LanguageModelTool<any>]> = [
    ["migrapilot_searchWorkspace", new SearchWorkspaceTool()],
    ["migrapilot_listFiles", new ListFilesTool()],
    ["migrapilot_readFile", new ReadFileTool()],
    ["migrapilot_diagnostics", new DiagnosticsTool()],
    ["migrapilot_gitDiff", new GitDiffTool()],
    ["migrapilot_runCommand", new RunCommandTool()],
    ["migrapilot_replaceInFile", new ReplaceInFileTool()],
    ["migrapilot_createFile", new CreateFileTool()],
    ["migrapilot_batchWriteFiles", new BatchWriteFilesTool()],
    ["migrapilot_moveFile", new MoveFileTool()],
    ["migrapilot_deleteFile", new DeleteFileTool()],
    ["migrapilot_applyPatch", new ApplyPatchTool()],
    ["migrapilot_scaffoldWebsite", new ScaffoldWebsiteTool()],
    ["migrapilot_startDevServer", new StartDevServerTool()],
    ["migrapilot_stopDevServer", new StopDevServerTool()],
    ["migrapilot_listDevServers", new ListDevServersTool()],
    ["migrapilot_openPreview", new OpenPreviewTool()],
    ["migrapilot_browserAudit", new BrowserAuditTool()],
    ["migrapilot_websiteTask", new WebsiteTaskTool()],
    ["migrapilot_activeContext", new ActiveContextTool()],
  ];

  for (const [name, tool] of tools) {
    context.subscriptions.push(vscode.lm.registerTool(name, tool));
  }
}
