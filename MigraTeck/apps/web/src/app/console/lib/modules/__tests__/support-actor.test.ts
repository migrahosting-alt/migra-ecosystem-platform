import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security-critical: support actor resolution.
 *
 * The production resolver had no email predicate — it selected from all active
 * staff and merely *preferred* the matching email, so an unmatched login fell
 * through to a hardcoded admin account. Every support action by the console
 * administrator was therefore recorded against a different person.
 *
 * These tests exist so that defect cannot come back silently.
 */

const panelQuery = vi.fn();
const panelExec = vi.fn();

vi.mock("../../db", () => ({
  panelQuery: (...args: unknown[]) => panelQuery(...args),
  panelExec: (...args: unknown[]) => panelExec(...args),
  isPanelDbConfigured: () => true,
}));

const load = async () => await import("../support");

const STAFF = { id: "u-real", name: "Real Agent" };

beforeEach(() => {
  vi.resetModules();
  panelQuery.mockReset();
  panelExec.mockReset();
  delete process.env.CONSOLE_ADMIN_EMAIL;
  delete process.env.CONSOLE_ADMIN_NAME;
});

describe("loadSupportActor — exact match only", () => {
  it("resolves a known staff member as itself", async () => {
    panelQuery.mockResolvedValueOnce([STAFF]);
    const { loadSupportActor } = await load();
    await expect(loadSupportActor("agent@migrateck.com")).resolves.toEqual(STAFF);
  });

  it("returns null for an unknown email — it must NOT pick an arbitrary employee", async () => {
    panelQuery.mockResolvedValueOnce([]); // exact-match query finds nobody
    const { loadSupportActor } = await load();
    await expect(loadSupportActor("stranger@example.com")).resolves.toBeNull();
  });

  it("filters by the authenticated email in SQL (regression guard for the fallback)", async () => {
    panelQuery.mockResolvedValueOnce([STAFF]);
    const { loadSupportActor } = await load();
    await loadSupportActor("agent@migrateck.com");

    const [sql, params] = panelQuery.mock.calls[0] as [string, unknown[]];
    // The defect was a preference ORDER BY with no WHERE on email.
    expect(sql).toMatch(/WHERE\s+LOWER\(email\)\s*=\s*LOWER\(\$1\)/i);
    expect(sql).not.toMatch(/ORDER BY[\s\S]*THEN 1/i);
    expect(sql).not.toContain("admin@migrahosting.com");
    expect(params).toContain("agent@migrateck.com");
  });

  it("returns null when no session email is supplied", async () => {
    const { loadSupportActor } = await load();
    await expect(loadSupportActor("")).resolves.toBeNull();
  });
});

describe("resolveSupportActor — fail closed", () => {
  it("denies an unknown authenticated email (not_staff)", async () => {
    panelQuery.mockResolvedValueOnce([]); // no exact staff
    panelQuery.mockResolvedValueOnce([]); // not known at all
    const { resolveSupportActor } = await load();
    await expect(resolveSupportActor("stranger@example.com")).resolves.toEqual({
      ok: false,
      reason: "not_staff",
    });
  });

  it("denies a disabled staff member (inactive)", async () => {
    panelQuery.mockResolvedValueOnce([]); // exact-match excludes inactive
    panelQuery.mockResolvedValueOnce([{ active: false }]); // but the row exists
    const { resolveSupportActor } = await load();
    await expect(resolveSupportActor("retired@migrateck.com")).resolves.toEqual({
      ok: false,
      reason: "inactive",
    });
  });

  it("denies a missing session", async () => {
    const { resolveSupportActor } = await load();
    await expect(resolveSupportActor(null)).resolves.toEqual({
      ok: false,
      reason: "no_session",
    });
  });

  it("never substitutes another employee when resolution fails", async () => {
    panelQuery.mockResolvedValueOnce([]);
    panelQuery.mockResolvedValueOnce([]);
    const { resolveSupportActor } = await load();
    const result = await resolveSupportActor("stranger@example.com");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("u-real");
  });
});

describe("environment admin resolves AS ITSELF", () => {
  it("provisions a canonical identity for CONSOLE_ADMIN_EMAIL and returns it", async () => {
    process.env.CONSOLE_ADMIN_EMAIL = "admin@migrateck.com";
    const ENV_ADMIN = { id: "u-envadmin", name: "admin@migrateck.com" };

    panelQuery.mockResolvedValueOnce([]); // first exact lookup: no users row (the live situation)
    panelExec.mockResolvedValueOnce(undefined); // idempotent insert
    panelQuery.mockResolvedValueOnce([ENV_ADMIN]); // re-read after insert

    const { resolveSupportActor } = await load();
    await expect(resolveSupportActor("admin@migrateck.com")).resolves.toEqual({
      ok: true,
      actor: ENV_ADMIN,
      actorType: "environment_admin",
    });

    // Identity is keyed on the AUTHENTICATED email, never another account.
    const [, params] = panelExec.mock.calls[0] as [string, unknown[]];
    expect(params).toContain("admin@migrateck.com");
  });

  it("does NOT treat the env admin as a fallback for someone else", async () => {
    process.env.CONSOLE_ADMIN_EMAIL = "admin@migrateck.com";
    panelQuery.mockResolvedValueOnce([]); // stranger has no staff row
    panelQuery.mockResolvedValueOnce([]); // and is unknown

    const { resolveSupportActor } = await load();
    const result = await resolveSupportActor("stranger@example.com");

    expect(result).toEqual({ ok: false, reason: "not_staff" });
    // Crucially: no identity was provisioned for the stranger.
    expect(panelExec).not.toHaveBeenCalled();
  });
});
