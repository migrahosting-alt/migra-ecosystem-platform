import fs from "node:fs";
import path from "node:path";

export type RunnerTarget = "auto" | "local" | "server";
export type EnvironmentName = "dev" | "stage" | "staging" | "prod" | "test";

export interface DesktopSettings {
  serverRunnerUrl: string;
  operatorId: string;
  role: string;
  defaultEnvironment: EnvironmentName;
  defaultRunnerTarget: RunnerTarget;
}

const DEFAULT_SETTINGS: DesktopSettings = {
  serverRunnerUrl: process.env.MIGRAPILOT_SERVER_RUNNER_URL ?? "http://127.0.0.1:7789",
  operatorId: "desktop-operator",
  role: "owner",
  defaultEnvironment: "dev",
  defaultRunnerTarget: "auto"
};

export class SettingsStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  read(): DesktopSettings {
    this.ensureParentDir();
    if (!fs.existsSync(this.filePath)) {
      this.write(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<DesktopSettings>;
      return this.normalize(parsed);
    } catch {
      this.write(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
  }

  write(next: Partial<DesktopSettings>): DesktopSettings {
    this.ensureParentDir();
    const normalized = this.normalize(next);
    fs.writeFileSync(this.filePath, JSON.stringify(normalized, null, 2), "utf8");
    return normalized;
  }

  update(next: Partial<DesktopSettings>): DesktopSettings {
    return this.write({ ...this.read(), ...next });
  }

  private ensureParentDir(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  private normalize(input: Partial<DesktopSettings>): DesktopSettings {
    const env = input.defaultEnvironment;
    const normalizedEnv: EnvironmentName =
      env === "dev" || env === "stage" || env === "staging" || env === "prod" || env === "test"
        ? env
        : DEFAULT_SETTINGS.defaultEnvironment;

    const target = input.defaultRunnerTarget;
    const normalizedTarget: RunnerTarget =
      target === "auto" || target === "local" || target === "server"
        ? target
        : DEFAULT_SETTINGS.defaultRunnerTarget;

    return {
      serverRunnerUrl: (input.serverRunnerUrl ?? DEFAULT_SETTINGS.serverRunnerUrl).trim() || DEFAULT_SETTINGS.serverRunnerUrl,
      operatorId: (input.operatorId ?? DEFAULT_SETTINGS.operatorId).trim() || DEFAULT_SETTINGS.operatorId,
      role: (input.role ?? DEFAULT_SETTINGS.role).trim() || DEFAULT_SETTINGS.role,
      defaultEnvironment: normalizedEnv,
      defaultRunnerTarget: normalizedTarget
    };
  }
}
