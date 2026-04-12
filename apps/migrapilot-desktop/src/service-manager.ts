import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { sanitizeLogLine } from "./sanitize.js";

export type ServiceName = "console" | "runner-local";

export interface ServiceStatus {
  name: ServiceName;
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  managedByDesktop?: boolean;
}

interface ServiceRuntime {
  status: ServiceStatus;
  process: ChildProcess | null;
  logs: string[];
}

export interface ServiceManagerOptions {
  workspaceRoot: string;
  consolePort: number;
  localRunnerPort: number;
}

export class ServiceManager extends EventEmitter {
  private readonly workspaceRoot: string;
  private readonly consolePort: number;
  private readonly localRunnerPort: number;
  private readonly runtimes: Record<ServiceName, ServiceRuntime>;

  constructor(options: ServiceManagerOptions) {
    super();
    this.workspaceRoot = options.workspaceRoot;
    this.consolePort = options.consolePort;
    this.localRunnerPort = options.localRunnerPort;
    this.runtimes = {
      console: this.createRuntime("console"),
      "runner-local": this.createRuntime("runner-local")
    };
  }

  async startAll(): Promise<void> {
    await this.start("runner-local");
    await this.start("console");
  }

  async stopAll(): Promise<void> {
    await this.stop("console");
    await this.stop("runner-local");
  }

  async restart(name: ServiceName): Promise<ServiceStatus> {
    await this.stop(name);
    await this.start(name);
    return this.getStatus()[name];
  }

  async start(name: ServiceName): Promise<ServiceStatus> {
    const runtime = this.runtimes[name];
    if (runtime.process) {
      return runtime.status;
    }

    if (await this.isServiceReachable(name)) {
      runtime.status = {
        ...runtime.status,
        running: true,
        pid: null,
        lastError: "Service already running externally on expected port",
        managedByDesktop: false
      };
      this.emit("status", this.getStatus());
      return runtime.status;
    }

    const descriptor = this.getDescriptor(name);
    const child = spawn(descriptor.command, descriptor.args, {
      cwd: descriptor.cwd,
      env: { ...process.env, ...descriptor.env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    runtime.process = child;
    runtime.status = {
      ...runtime.status,
      running: true,
      pid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      lastError: null,
      managedByDesktop: true
    };

    const appendLog = (raw: string) => {
      const clean = sanitizeLogLine(raw.toString().trim());
      if (!clean) return;
      runtime.logs.push(clean);
      if (runtime.logs.length > 200) {
        runtime.logs.shift();
      }
      this.emit("log", { service: name, line: clean });
    };

    child.stdout?.on("data", (chunk) => appendLog(String(chunk)));
    child.stderr?.on("data", (chunk) => appendLog(String(chunk)));
    child.on("exit", (code) => {
      runtime.process = null;
      runtime.status = {
        ...runtime.status,
        running: false,
        pid: null,
        lastExitCode: code,
        lastError: code === 0 ? null : `Exited with code ${code ?? -1}`,
        managedByDesktop: false
      };
      this.emit("status", this.getStatus());
    });

    this.emit("status", this.getStatus());
    return runtime.status;
  }

  async stop(name: ServiceName): Promise<ServiceStatus> {
    const runtime = this.runtimes[name];
    if (!runtime.process) {
      if (await this.isServiceReachable(name)) {
        runtime.status = {
          ...runtime.status,
          running: true,
          pid: null,
          lastError: "Service is externally managed; stop it from its owning process",
          managedByDesktop: false
        };
        this.emit("status", this.getStatus());
      }
      return runtime.status;
    }

    const child = runtime.process;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 5000);

      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });

    runtime.process = null;
    runtime.status = {
      ...runtime.status,
      running: false,
      pid: null,
      managedByDesktop: false
    };

    this.emit("status", this.getStatus());
    return runtime.status;
  }

  getStatus(): Record<ServiceName, ServiceStatus> {
    return {
      console: { ...this.runtimes.console.status },
      "runner-local": { ...this.runtimes["runner-local"].status }
    };
  }

  getLogs(name: ServiceName): string[] {
    return [...this.runtimes[name].logs];
  }

  private createRuntime(name: ServiceName): ServiceRuntime {
    return {
      status: {
        name,
        running: false,
        pid: null,
        startedAt: null,
        lastExitCode: null,
        lastError: null,
        managedByDesktop: false
      },
      process: null,
      logs: []
    };
  }

  private getDescriptor(name: ServiceName): {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  } {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    if (name === "console") {
      const cwd = path.join(this.workspaceRoot, "apps", "migrapilot-console");
      const mode = process.env.MIGRAPILOT_DESKTOP_CONSOLE_MODE ?? (process.env.NODE_ENV === "production" ? "start" : "dev");
      return {
        command: npmCommand,
        args: ["run", mode, "--", "-p", String(this.consolePort)],
        cwd,
        env: {
          PORT: String(this.consolePort)
        }
      };
    }

    const runnerCwd = path.join(this.workspaceRoot, "apps", "migrapilot-runner-local");
    const distRunner = path.join(runnerCwd, "dist", "server.js");
    if (fs.existsSync(distRunner)) {
      return {
        command: "node",
        args: [distRunner],
        cwd: this.workspaceRoot,
        env: {
          PORT: String(this.localRunnerPort)
        }
      };
    }

    return {
      command: npmCommand,
      args: ["run", "dev"],
      cwd: runnerCwd,
      env: {
        PORT: String(this.localRunnerPort)
      }
    };
  }

  private async isServiceReachable(name: ServiceName): Promise<boolean> {
    const endpoint =
      name === "console"
        ? `http://127.0.0.1:${this.consolePort}/api/state`
        : `http://127.0.0.1:${this.localRunnerPort}/health`;

    try {
      const response = await fetch(endpoint);
      return response.ok;
    } catch {
      return false;
    }
  }
}
