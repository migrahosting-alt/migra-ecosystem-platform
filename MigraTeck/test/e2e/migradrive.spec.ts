import { expect, test, type Page } from "@playwright/test";

const email = process.env.PLAYWRIGHT_TEST_EMAIL || "owner+migramarket-e2e@migrateck.com";
const password = process.env.PLAYWRIGHT_TEST_PASSWORD || "ChangeMeImmediately123!";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

test.describe("MigraDrive workspace", () => {
  test("loads workspace and bootstrap state", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive");

    await expect(page.getByRole("heading", { name: "MigraDrive" })).toBeVisible();
    await expect(page.getByTestId("tenant-status")).toBeVisible();
  });

  test("file list renders seeded rows", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive");

    await expect(page.getByTestId("file-row").first()).toBeVisible();
    await expect(page.getByText("seed-active-readme.txt")).toBeVisible();
  });

  test("upload flow creates a new file row", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive");

    const uploadInput = page.getByTestId("upload-input");
    await uploadInput.setInputFiles({
      name: "playwright-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("uploaded from playwright\n", "utf8"),
    });

    await expect(page.getByText("Uploaded playwright-upload.txt.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "playwright-upload.txt" })).toBeVisible();
  });

  test("download action opens a signed mock download URL", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive");

    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId("download-btn").first().click();
    const popup = await popupPromise;

    await expect(popup).toHaveURL(/\/mock-download\//);
  });

  test("share action issues a link", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive");

    await page.getByTestId("share-btn").first().click();
    await expect(page.getByText("Share link issued and copied to the clipboard.")).toBeVisible();
  });

  test("pending upload can be canceled from the workspace", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId("cancel-btn").first().click();

    await expect(page.getByText("Pending upload canceled.")).toBeVisible();
  });

  test("restricted tenant blocks write actions", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive?mockState=RESTRICTED");

    await expect(page.getByTestId("tenant-status")).toContainText("RESTRICTED");
    await expect(page.getByTestId("upload-btn")).toBeDisabled();
    await expect(page.getByText(/Read-only mode is active/i)).toBeVisible();
  });

  test("disabled tenant blocks access", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive?mockState=DISABLED");

    await expect(page.getByTestId("drive-blocked-disabled")).toContainText(/Account disabled/i);
  });

  test("pending tenant renders setup state", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive?mockState=PENDING");

    await expect(page.getByTestId("drive-blocked-pending")).toContainText(/Setup in progress/i);
  });

  test("empty state renders cleanly", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/drive?mockEmpty=true");

    await expect(page.getByTestId("drive-empty-state")).toContainText(/No active or pending files/i);
  });
});