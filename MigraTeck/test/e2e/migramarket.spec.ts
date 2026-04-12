import { expect, test } from "@playwright/test";

const email = process.env.PLAYWRIGHT_TEST_EMAIL || "owner+migramarket-e2e@migrateck.com";
const password = process.env.PLAYWRIGHT_TEST_PASSWORD || "ChangeMeImmediately123!";

test("MigraMarket workspace supports operator CRUD workflows", async ({ page, request }) => {
  await test.step("Sign in and open MigraMarket", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/app/);
    await page.getByRole("link", { name: "MigraMarket" }).click();
    await expect(page.getByRole("heading", { name: /Enterprise growth operations workspace/i })).toBeVisible();
    await expect(page.getByTestId("migramarket-kpis")).toBeVisible();
  });

  await test.step("Assign package and save profile", async () => {
    const packageSection = page.getByTestId("package-automation-section");
    await packageSection.getByRole("button", { name: "Assign package" }).first().click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("assigned");

    const profileSection = page.getByTestId("client-profile-section");
    await profileSection.getByTestId("profile-gbp-url").fill("https://business.google.com/example");
    await profileSection.getByTestId("profile-website-url").fill("https://migramarket.example.com");
    await profileSection.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Workspace profile saved.");
  });

  await test.step("Create, edit, publish, and delete a lead form", async () => {
    const leadSection = page.getByTestId("lead-pipeline-section");
    await leadSection.getByPlaceholder("Form name").fill("Website Hero Form");
    await leadSection.getByPlaceholder("form-slug").fill("website-hero-form");
    await leadSection.getByRole("button", { name: "Create form" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Intake form created.");

    const formCard = page.getByTestId("lead-form-card-website-hero-form");
    await expect(formCard).toBeVisible();
    await formCard.locator('input[value="Website Hero Form"]').fill("Website Hero Intake");
    await formCard.getByLabel("Published").uncheck();
    await formCard.getByRole("button", { name: "Save form" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Intake form updated.");
    await expect(formCard.locator('input[value="Website Hero Intake"]')).toBeVisible();
  });

  await test.step("Accept a public intake and manage pipeline leads", async () => {
    const intakeResponse = await request.post("/api/migramarket/intake/submit", {
      data: {
        orgSlug: "migramarket-playwright-org",
        formSlug: "primary-intake",
        fullName: "Public Intake Lead",
        email: "public.intake@example.com",
        phone: "5551234567",
        company: "Public Intake Co",
        campaign: "spring-campaign",
      },
    });
    expect(intakeResponse.ok()).toBeTruthy();

    const leadSection = page.getByTestId("lead-pipeline-section");
    await leadSection.getByPlaceholder("Full name").fill("UI Lead Contact");
    await leadSection.getByPlaceholder("Company").fill("UI Lead Company");
    await leadSection.getByPlaceholder("Email").last().fill("ui.lead@example.com");
    await leadSection.getByPlaceholder("Phone").last().fill("5559876543");
    await leadSection.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Lead recorded.");

    const leadCard = page
      .locator('[data-testid^="lead-card-"]')
      .filter({ has: page.locator('input[value="UI Lead Contact"]') })
      .first();
    await leadCard.getByRole("combobox").first().selectOption("qualified");
    await leadCard.getByRole("button", { name: "Save lead" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Lead updated.");
  });

  await test.step("Create, edit, and delete reporting snapshot", async () => {
    const reportingSection = page.getByTestId("reporting-section");
    await reportingSection.getByPlaceholder("March 2026").fill("Playwright Snapshot");
    const dateInputs = reportingSection.locator('input[type="datetime-local"]');
    await dateInputs.nth(0).fill("2026-03-01T09:00");
    await dateInputs.nth(1).fill("2026-03-31T18:00");
    await reportingSection.getByPlaceholder("Leads").fill("12");
    await reportingSection.getByPlaceholder("Calls").fill("7");
    await reportingSection.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Report snapshot saved.");

    const reportCard = page
      .locator('[data-testid^="report-card-"]')
      .filter({ has: page.locator('input[value="Playwright Snapshot"]') })
      .first();
    await reportCard.locator('input[value="Playwright Snapshot"]').fill("Playwright Snapshot Updated");
    await reportCard.getByRole("spinbutton").first().fill("14");
    await reportCard.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Report snapshot updated.");

    page.once("dialog", (dialog) => dialog.accept());
    await reportCard.getByRole("button", { name: "Delete snapshot" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Report snapshot deleted.");
  });

  await test.step("Create, edit, and delete locations and tasks", async () => {
    const locationsSection = page.getByTestId("locations-section");
    await locationsSection.getByPlaceholder("Location name").fill("Bronx HQ");
    await locationsSection.getByPlaceholder("City").fill("Bronx");
    await locationsSection.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Location added.");

    const locationCard = page
      .locator('[data-testid^="location-card-"]')
      .filter({ has: page.locator('input[value="Bronx HQ"]') })
      .first();
    await locationCard.locator('input[value="Bronx"]').fill("Brooklyn");
    await locationCard.getByRole("button", { name: "Save location" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Location updated.");

    const operationsSection = page.getByTestId("operations-section");
    await operationsSection.getByPlaceholder("Task title").fill("Playwright follow-up task");
    await operationsSection.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Task created.");

    const taskCard = page.locator('[data-testid^="task-card-"]').filter({ hasText: "Playwright follow-up task" }).first();
    await taskCard.getByRole("combobox").first().selectOption("in_progress");
    await taskCard.getByRole("button", { name: "Save task" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Task updated.");

    page.once("dialog", (dialog) => dialog.accept());
    await taskCard.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Task deleted.");

    page.once("dialog", (dialog) => dialog.accept());
    await locationCard.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Location deleted.");
  });

  await test.step("Delete the draft form from the UI", async () => {
    const formCard = page.getByTestId("lead-form-card-website-hero-form");
    page.once("dialog", (dialog) => dialog.accept());
    await formCard.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("migramarket-activity")).toContainText("Intake form deleted.");
  });
});
