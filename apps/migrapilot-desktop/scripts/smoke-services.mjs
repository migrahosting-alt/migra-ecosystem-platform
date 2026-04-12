import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');

const { ServiceManager } = await import('../dist/service-manager.js');
const { createBrainServer } = await import('../dist/brain-server.js');
const { SettingsStore } = await import('../dist/settings.js');

async function findFreePort(startPort) {
  let port = startPort;
  while (port < startPort + 100) {
    // eslint-disable-next-line no-await-in-loop
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
    if (free) {
      return port;
    }
    port += 1;
  }
  throw new Error(`No free port in range starting ${startPort}`);
}

const tmpSettingsPath = path.join(appRoot, '.tmp-settings-smoke.json');
const store = new SettingsStore(tmpSettingsPath);

const basePort = Number(process.env.MIGRAPILOT_SMOKE_BASE_PORT ?? 18770);
const CONSOLE_PORT = await findFreePort(basePort);
const LOCAL_PORT = await findFreePort(CONSOLE_PORT + 1);
const BRAIN_PORT = await findFreePort(LOCAL_PORT + 1);

store.write({
  serverRunnerUrl: process.env.MIGRAPILOT_SERVER_RUNNER_URL ?? 'http://127.0.0.1:7789',
  operatorId: 'smoke-user',
  role: 'owner',
  defaultEnvironment: 'dev',
  defaultRunnerTarget: 'auto'
});

const services = new ServiceManager({
  workspaceRoot,
  consolePort: CONSOLE_PORT,
  localRunnerPort: LOCAL_PORT
});

let brain;
let failed = false;

async function waitFor(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

try {
  await services.startAll();
  brain = await createBrainServer({
    port: BRAIN_PORT,
    consoleBaseUrl: `http://127.0.0.1:${CONSOLE_PORT}`,
    serviceManager: services,
    getSettings: () => store.read(),
    saveSettings: (next) => store.update(next)
  });

  await waitFor(`http://127.0.0.1:${LOCAL_PORT}/health`);
  await waitFor(`http://127.0.0.1:${CONSOLE_PORT}/api/state`);
  await waitFor(`http://127.0.0.1:${BRAIN_PORT}/health`);

  const status = await fetch(`http://127.0.0.1:${BRAIN_PORT}/api/services/status`).then((r) => r.json());
  if (!status?.ok) {
    throw new Error('brain service status check failed');
  }

  const execute = await fetch(`http://127.0.0.1:${BRAIN_PORT}/api/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      toolName: 'repo.search',
      runnerTarget: 'local',
      environment: 'dev',
      operator: { operatorId: 'smoke-user', role: 'owner' },
      toolInput: {
        query: 'mission',
        maxResults: 3
      }
    })
  }).then((r) => r.json());

  if (!execute?.ok || !execute?.data?.result?.ok) {
    throw new Error(`brain execute smoke failed: ${JSON.stringify(execute)}`);
  }

  const policy = await fetch(`http://127.0.0.1:${BRAIN_PORT}/api/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      toolName: 'inventory.services.topology',
      runnerTarget: 'local',
      environment: 'dev',
      operator: { operatorId: 'smoke-user', role: 'owner' },
      toolInput: {}
    })
  }).then((r) => r.json());

  if (policy?.ok !== false || policy?.error?.code !== 'POLICY_VIOLATION') {
    throw new Error(`policy check failed: ${JSON.stringify(policy)}`);
  }

  console.log('Desktop services smoke passed');
} catch (error) {
  failed = true;
  console.error('Desktop services smoke failed');
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    await brain?.close();
  } catch {
    // ignore
  }
  try {
    await services.stopAll();
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(tmpSettingsPath);
  } catch {
    // ignore
  }

  // Ensure script does not hang on child process stdio handles.
  process.exit(failed ? 1 : 0);
}
