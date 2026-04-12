import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog } from "electron";

import { createBrainServer } from "./brain-server.js";
import { ServiceManager } from "./service-manager.js";
import { SettingsStore } from "./settings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRAIN_PORT = Number(process.env.MIGRAPILOT_BRAIN_PORT ?? 7777);
const CONSOLE_PORT = Number(process.env.MIGRAPILOT_CONSOLE_PORT ?? 7776);
const LOCAL_RUNNER_PORT = Number(process.env.MIGRAPILOT_LOCAL_RUNNER_PORT ?? 7788);

let mainWindow: BrowserWindow | null = null;
let brainController: Awaited<ReturnType<typeof createBrainServer>> | null = null;
let serviceManager: ServiceManager | null = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

async function bootstrap(): Promise<void> {
  const workspaceRoot = process.env.MIGRAPILOT_WORKSPACE_ROOT ?? path.resolve(app.getAppPath(), "..", "..");
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  const settingsStore = new SettingsStore(settingsPath);

  serviceManager = new ServiceManager({
    workspaceRoot,
    consolePort: CONSOLE_PORT,
    localRunnerPort: LOCAL_RUNNER_PORT
  });

  await serviceManager.startAll();

  brainController = await createBrainServer({
    port: BRAIN_PORT,
    consoleBaseUrl: `http://127.0.0.1:${CONSOLE_PORT}`,
    serviceManager,
    getSettings: () => settingsStore.read(),
    saveSettings: (next) => settingsStore.update(next)
  });

  mainWindow = new BrowserWindow({
    width: 1640,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#0a1222",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const rendererPath = path.join(__dirname, "renderer", "index.html");
  await mainWindow.loadFile(rendererPath, {
    query: {
      brainUrl: `http://127.0.0.1:${BRAIN_PORT}`,
      consoleUrl: `http://127.0.0.1:${CONSOLE_PORT}`
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function shutdown(): Promise<void> {
  if (brainController) {
    await brainController.close();
    brainController = null;
  }
  if (serviceManager) {
    await serviceManager.stopAll();
    serviceManager = null;
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on("before-quit", () => {
  void shutdown();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }
  try {
    await bootstrap();
  } catch (error) {
    await dialog.showErrorBox(
      "MigraPilot Desktop Startup Failed",
      (error as Error).stack ?? (error as Error).message
    );
    await shutdown();
    app.exit(1);
  }
});
