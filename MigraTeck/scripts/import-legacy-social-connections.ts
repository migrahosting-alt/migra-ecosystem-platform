import { execFileSync } from "node:child_process";
import process from "node:process";
import { PrismaClient, type Prisma } from "@prisma/client";
import { encryptSocialJson, encryptSocialSecret } from "../src/lib/migramarket-social-secrets";
import { getSocialPlatformDefinition } from "../src/lib/migramarket-social-platforms";

type LegacyConnectionRow = {
  id: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  platform: string;
  accountName: string;
  accountId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  profileUrl: string | null;
  profileImage: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  engagementRate: number | null;
  isVerified: number | null;
  isActive: number | null;
  scope: string | null;
  connectionMethod: string | null;
  pageType: string | null;
  lastSyncAt: string | null;
  metadata: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
};

type Options = {
  legacyDbPath: string;
  targetOrgSlug: string;
  dryRun: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): Options {
  let legacyDbPath = "/var/www/marketing.migrahosting.com/prisma/prod.db";
  let targetOrgSlug = "migrahosting-admin";
  let dryRun = false;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--legacy-db-path" && argv[index + 1]) {
      legacyDbPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--target-org-slug" && argv[index + 1]) {
      targetOrgSlug = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (value === "--force") {
      force = true;
      continue;
    }
  }

  return { legacyDbPath, targetOrgSlug, dryRun, force };
}

function runSqliteJsonQuery(dbPath: string, sql: string): LegacyConnectionRow[] {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output || "[]") as LegacyConnectionRow[];
}

function parseScopeList(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // Fall through to string splitting.
  }
  return raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed legacy metadata.
  }
  return {};
}

function inferHandle(row: LegacyConnectionRow): string {
  const accountName = row.accountName?.trim();
  if (accountName) return accountName;
  const profileUrl = row.profileUrl?.trim();
  if (profileUrl) {
    try {
      const url = new URL(profileUrl);
      const slug = url.pathname.split("/").filter(Boolean).pop();
      if (slug) {
        return slug.startsWith("@") ? slug : row.platform === "x" || row.platform === "instagram" || row.platform === "tiktok" ? `@${slug}` : slug;
      }
    } catch {
      // Ignore malformed URLs.
    }
  }
  return `${row.platform}-legacy-${row.id.slice(0, 8)}`;
}

function normalizeProfileType(row: LegacyConnectionRow): string {
  const pageType = String(row.pageType || "").trim().toLowerCase();
  if (pageType) return pageType;
  if (row.platform === "facebook") return "page";
  if (row.platform === "youtube") return "channel";
  return "profile";
}

function hasUsableToken(token: string | null): boolean {
  const raw = String(token || "").trim();
  if (!raw) return false;
  if (/^demo-token-/i.test(raw)) return false;
  if (raw.length < 32) return false;
  return true;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildConnectionMetadata(row: LegacyConnectionRow, usableToken: boolean): Prisma.InputJsonValue {
  const definition = getSocialPlatformDefinition(row.platform);
  const metadata = {
    displayName: row.accountName || inferHandle(row),
    avatarUrl: row.profileImage || null,
    connectionLabel: row.accountName || inferHandle(row),
    migrationState: usableToken ? "pending_sync" : "reconnect_required",
    migrationNote: usableToken
      ? "Imported from legacy marketing infrastructure. Run Sync here in MigraMarket to validate this OAuth connection in the Postgres-backed system."
      : "Imported from the legacy marketing stack, but the stored credential was only a placeholder/demo token. Reconnect this channel in MigraMarket so Postgres becomes the system of record.",
    legacySourceLabel: "marketing.migrahosting.com",
    legacyConnectionMethod: row.connectionMethod || "oauth",
    legacyProfileUrl: row.profileUrl || null,
    legacyFollowers: Number(row.followers || 0),
    legacyFollowing: Number(row.following || 0),
    legacyPostsCount: Number(row.postsCount || 0),
    legacyEngagementRate: Number(row.engagementRate || 0),
    legacyImportedFromPlatformAccountId: row.id,
    legacyImportedFromOrgSlug: row.organizationSlug,
    importedAt: new Date().toISOString(),
    platformDefaultPublishMode: definition?.defaultPublishMode || "assisted",
    platformApiSupported: definition?.apiSupported || false,
    legacyMetadata: parseMetadata(row.metadata),
  };
  return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const targetOrg = await prisma.organization.findUnique({
      where: { slug: options.targetOrgSlug },
      select: { id: true, slug: true, name: true },
    });

    if (!targetOrg) {
      throw new Error(`Target organization slug not found: ${options.targetOrgSlug}`);
    }

    const query = `
      SELECT
        pa.id,
        pa.organizationId,
        org.slug AS organizationSlug,
        org.name AS organizationName,
        pa.platform,
        pa.accountName,
        pa.accountId,
        pa.accessToken,
        pa.refreshToken,
        pa.tokenExpiresAt,
        pa.profileUrl,
        pa.profileImage,
        pa.bio,
        pa.followers,
        pa.following,
        pa.postsCount,
        pa.engagementRate,
        pa.isVerified,
        pa.isActive,
        pa.scope,
        pa.connectionMethod,
        pa.pageType,
        pa.lastSyncAt,
        pa.metadata,
        pa.connectedAt,
        pa.updatedAt
      FROM PlatformAccount pa
      INNER JOIN Organization org ON org.id = pa.organizationId
      ORDER BY pa.platform ASC, pa.accountName ASC
    `;

    const legacyRows = runSqliteJsonQuery(options.legacyDbPath, query);
    if (!legacyRows.length) {
      console.log("No legacy social connections were found.");
      return;
    }

    const summary = {
      targetOrgSlug: targetOrg.slug,
      imported: 0,
      updated: 0,
      skipped: 0,
      reconnectRequired: 0,
      readyForSync: 0,
    };

    for (const row of legacyRows) {
      const platform = row.platform.trim().toLowerCase();
      const handle = inferHandle(row);
      const definition = getSocialPlatformDefinition(platform);
      const usableToken = hasUsableToken(row.accessToken);
      const publishMode = definition?.defaultPublishMode || "assisted";
      const accessModel = row.connectionMethod?.trim().toLowerCase() === "oauth" ? "oauth" : "profile_access";
      const scopes = parseScopeList(row.scope);

      const existing = await prisma.migraMarketSocialConnection.findUnique({
        where: {
          orgId_platform_handle: {
            orgId: targetOrg.id,
            platform,
            handle,
          },
        },
      });

      if (existing?.credentialCiphertext && !options.force) {
        summary.skipped += 1;
        continue;
      }

      const data: Prisma.MigraMarketSocialConnectionUncheckedCreateInput = {
        orgId: targetOrg.id,
        platform,
        handle,
        profileType: normalizeProfileType(row),
        profileUrl: row.profileUrl || null,
        publishMode,
        accessModel,
        status: usableToken ? "ready" : "reconnect_required",
        externalAccountId: row.accountId || null,
        scopes: JSON.parse(JSON.stringify(scopes)) as Prisma.InputJsonValue,
        metadata: buildConnectionMetadata(row, usableToken),
        tokenExpiresAt: toDate(row.tokenExpiresAt),
        lastVerifiedAt: usableToken ? null : null,
        createdAt: toDate(row.connectedAt) || new Date(),
        updatedAt: toDate(row.updatedAt) || new Date(),
      };

      if (usableToken && row.accessToken) {
        data.credentialCiphertext = encryptSocialJson({
          accessToken: row.accessToken,
          publishAccessToken: null,
        });
      }

      if (usableToken && row.refreshToken) {
        data.refreshTokenCiphertext = encryptSocialSecret(row.refreshToken);
      }

      if (options.dryRun) {
        if (existing) {
          summary.updated += 1;
        } else {
          summary.imported += 1;
        }
        if (usableToken) {
          summary.readyForSync += 1;
        } else {
          summary.reconnectRequired += 1;
        }
        continue;
      }

      if (existing) {
        await prisma.migraMarketSocialConnection.update({
          where: { id: existing.id },
          data,
        });
        summary.updated += 1;
      } else {
        await prisma.migraMarketSocialConnection.create({ data });
        summary.imported += 1;
      }

      if (usableToken) {
        summary.readyForSync += 1;
      } else {
        summary.reconnectRequired += 1;
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
