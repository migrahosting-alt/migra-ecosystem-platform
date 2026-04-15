/**
 * MigraAuth seed — Register default first-party OAuth clients.
 * Run: pnpm --filter @migrateck/auth-api db:seed
 */
import { config } from "./config/env.js";
import { createAuthPrismaAdapter, PrismaClient } from "./prisma-client.js";

const db = new PrismaClient({
  adapter: createAuthPrismaAdapter(config.databaseUrl),
});

const clients = [
  {
    clientId: "migrateck_web",
    clientName: "MigraTeck Web",
    clientType: "web",
    redirectUris: [
      "https://migrateck.com/auth/callback",
      "http://localhost:3000/auth/callback",
    ],
    postLogoutRedirectUris: [
      "https://migrateck.com/login",
      "http://localhost:3000/login",
    ],
    allowedScopes: ["openid", "profile", "email", "offline_access", "orgs:read"],
  },
  {
    clientId: "migrahosting_web",
    clientName: "MigraHosting Web",
    clientType: "web",
    redirectUris: [
      "https://vps.migrahosting.com/auth/callback",
      "http://localhost:3000/auth/callback",
    ],
    postLogoutRedirectUris: [
      "https://vps.migrahosting.com/login",
      "http://localhost:3000/login",
    ],
    allowedScopes: ["openid", "profile", "email", "offline_access", "orgs:read"],
  },
  {
    clientId: "migradrive_web",
    clientName: "MigraDrive Web",
    clientType: "web",
    redirectUris: [
      "https://migradrive.com/auth/callback",
      "http://localhost:3000/auth/callback",
    ],
    postLogoutRedirectUris: [
      "https://migradrive.com",
      "http://localhost:3000",
    ],
    allowedScopes: ["openid", "profile", "email", "offline_access"],
  },
  {
    clientId: "migramail_web",
    clientName: "MigraMail Web",
    clientType: "web",
    redirectUris: [
      "https://migramail.com/auth/callback",
      "http://localhost:3001/auth/callback",
    ],
    postLogoutRedirectUris: [
      "https://migramail.com",
      "http://localhost:3001",
    ],
    allowedScopes: ["openid", "profile", "email", "offline_access"],
  },
  {
    clientId: "migrapanel_web",
    clientName: "MigraPanel Web",
    clientType: "web",
    redirectUris: [
      "https://migrapanel.com/auth/callback",
      "https://panel.migrateck.com/auth/callback",
      "http://localhost:3002/auth/callback",
    ],
    postLogoutRedirectUris: [
      "https://migrapanel.com",
      "https://panel.migrateck.com",
      "http://localhost:3002",
    ],
    allowedScopes: ["openid", "profile", "email", "offline_access", "orgs:read"],
  },
  {
    clientId: "migravoice_web",
    clientName: "MigraVoice Web",
    clientType: "web",
    redirectUris: [
      "https://migravoice.com/auth/callback",
      "http://localhost:3003/auth/callback",
    ],
    postLogoutRedirectUris: [
      "https://migravoice.com",
      "http://localhost:3003",
    ],
    allowedScopes: ["openid", "profile", "email", "offline_access"],
  },
];

async function seed() {
  console.log("Seeding MigraAuth OAuth clients...");

  for (const client of clients) {
    await db.oAuthClient.upsert({
      where: { clientId: client.clientId },
      update: {
        clientName: client.clientName,
        clientType: client.clientType,
        redirectUris: client.redirectUris,
        postLogoutRedirectUris: client.postLogoutRedirectUris,
        allowedScopes: client.allowedScopes,
      },
      create: {
        clientId: client.clientId,
        clientName: client.clientName,
        clientType: client.clientType,
        redirectUris: client.redirectUris,
        postLogoutRedirectUris: client.postLogoutRedirectUris,
        allowedScopes: client.allowedScopes,
        isFirstParty: true,
        isActive: true,
      },
    });
    console.log(`  ✓ ${client.clientId} (${client.clientName})`);
  }

  console.log("Done.");
  await db.$disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
