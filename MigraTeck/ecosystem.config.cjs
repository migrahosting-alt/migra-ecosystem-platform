/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const cwd = __dirname;

function parseEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return {};
  const raw = fs.readFileSync(filepath, "utf8");
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const productionEnv = parseEnvFile(path.join(cwd, ".env.production"));
const env = {
  ...productionEnv,
  NODE_ENV: "production",
};

module.exports = {
  apps: [
    {
      name: "migrateck-web",
      cwd,
      script: "npm",
      args: "start",
      interpreter: "none",
      env,
    },
    {
      name: "migrateck-provision-worker",
      cwd,
      script: "npx",
      args: "--yes tsx workers/provisioning-engine.ts",
      interpreter: "none",
      env: {
        ...env,
        RUN_PROVISIONING_ENGINE_WORKER: "true",
      },
    },
    {
      name: "migrateck-vps-action-worker",
      cwd,
      script: "npx",
      args: "--yes tsx workers/vps-action-reconcile.ts",
      interpreter: "none",
      env: {
        ...env,
        RUN_VPS_ACTION_RECONCILE_WORKER: "true",
      },
    },
    {
      name: "migrateck-entitlement-worker",
      cwd,
      script: "npx",
      args: "--yes tsx workers/entitlement-expiry.ts",
      interpreter: "none",
      env: {
        ...env,
        RUN_ENTITLEMENT_EXPIRY_WORKER: "true",
      },
    },
    {
      name: "migrateck-social-sync-worker",
      cwd,
      script: "npx",
      args: "--yes tsx workers/social-connection-sync.ts",
      interpreter: "none",
      env: {
        ...env,
        RUN_SOCIAL_CONNECTION_SYNC_WORKER: "true",
      },
    },
  ],
};
