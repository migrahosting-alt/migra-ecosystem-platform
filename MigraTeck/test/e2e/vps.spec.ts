import { expect, test } from "@playwright/test";

const email = process.env.PLAYWRIGHT_TEST_EMAIL || "owner+migramarket-e2e@migrateck.com";
const password = process.env.PLAYWRIGHT_TEST_PASSWORD || "ChangeMeImmediately123!";
const serverId = process.env.PLAYWRIGHT_VPS_SERVER_ID || "cm_vps_playwright_alpha";

async function signIn(page: Parameters<typeof test>[0]["page"]) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

test.describe("MigraHosting VPS portal", () => {
  test("supports console launch and Debian 13 rebuild workflow", async ({ page }) => {
    await signIn(page);

    await test.step("Fleet and server overview render", async () => {
      await page.goto("/app/vps");
      await expect(page.getByRole("heading", { name: "VPS Servers" })).toBeVisible();
      const serverRow = page.locator("tr").filter({ hasText: "alpha-node.example.internal" }).first();
      await expect(serverRow).toBeVisible();
      await page.goto(`/app/vps/${serverId}`);
      await expect(page.getByRole("heading", { name: "Quick details" })).toBeVisible();
      await expect(page.getByText("Ubuntu 24.04 LTS (ubuntu-24-04)")).toBeVisible();
    });

    await test.step("Settings page exposes Debian 13 image inventory", async () => {
      await page.goto(`/app/vps/${serverId}/settings`);
      await expect(page.getByRole("heading", { name: "Operating system images" })).toBeVisible();
      await expect(page.getByText("Debian 13")).toBeVisible();
      await expect(page.getByText(/Current image/i)).toBeVisible();
      await expect(page.getByText("Ubuntu 24.04 LTS (ubuntu-24-04)")).toBeVisible();
    });

    await test.step("Console page launches a browser console session", async () => {
      await page.goto(`/app/vps/${serverId}/console`);
      const popupPromise = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Launch Console Session" }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      await expect(page.getByText(/Console session ready/i)).toBeVisible();
      await expect(page.getByText(/https:\/\/console\.integration\.migrateck\.com\/session/i)).toBeVisible();
    });

    await test.step("Rebuild flow accepts Debian 13 and updates server metadata", async () => {
      await page.goto(`/app/vps/${serverId}`);
      await page.getByRole("button", { name: "Rebuild Server" }).click();

      await page.getByLabel("Operating system image").selectOption("debian-13");
      await page.getByLabel("Reason for reinstall").fill("Client requested Debian 13 before first production login.");
      await page.getByPlaceholder("alpha-node").fill("alpha-node");
      await page.getByRole("button", { name: /Rebuild to Debian 13/i }).click();

      await expect(page.getByText(/Rebuild completed\./i)).toBeVisible();

      await page.goto(`/app/vps/${serverId}/settings`);
      await expect(page.getByText("Debian 13 (debian-13)")).toBeVisible();
      await expect(page.getByText(/^13$/)).toBeVisible();
    });
  });
});