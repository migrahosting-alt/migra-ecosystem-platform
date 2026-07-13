/**
 * Phase D — the difference between "nothing ran" and "it ran and failed".
 *
 * This is the single most consequential thing the approval card communicates. After a REFUSAL the
 * action never executed and there is nothing to go and check. After a FAILURE it executed against
 * real infrastructure and may have partially landed. An operator who confuses the two walks away
 * believing nothing happened when something half did.
 *
 * The card must therefore never render a tidy success — or a tidy refusal — over a live mutation
 * that actually ran.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
}));

// vi.mock is hoisted, so the fns must be created INSIDE the factory and imported back after.
vi.mock("../../src/approvals/client", () => ({
  approve: vi.fn(),
  reject: vi.fn(),
  resume: vi.fn(),
}));

import * as vscode from "vscode";
import { approve, reject, resume } from "../../src/approvals/client";
import { ApprovalController } from "../../src/approvals/controller";

function controller() {
  const seen: Array<{ id: string; status: string; detail?: string }> = [];
  const c = new ApprovalController({
    baseUrl: () => "http://127.0.0.1:3377",
    sink: { status: (id, status, detail) => seen.push({ id, status, detail }) },
  });
  return { c, seen, last: () => seen[seen.length - 1]! };
}

beforeEach(() => { vi.mocked(approve).mockReset(); vi.mocked(reject).mockReset(); vi.mocked(resume).mockReset(); vi.clearAllMocks(); });

describe("the action RAN and succeeded", () => {
  it("reports EXECUTED, and says it ran once", async () => {
    vi.mocked(approve).mockResolvedValue({ ok: true, status: "EXECUTED", outcome: { status: "EXECUTED", toolName: "dns.createRecord" } });
    const { c, last } = controller();
    await c.handle("approve", "pa1");
    expect(last().status).toBe("EXECUTED");
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });
});

describe("the action RAN and FAILED — it may have partially landed", () => {
  it("is reported as FAILED, with the server's typed error, and raised as an ERROR", async () => {
    vi.mocked(approve).mockResolvedValue({
      ok: false,
      outcome: { status: "FAILED", toolName: "dns.createRecord", error: { code: "UPSTREAM_TIMEOUT", message: "DNS provider timed out" } },
      error: { code: "UPSTREAM_TIMEOUT", message: "DNS provider timed out" },
    });
    const { c, last } = controller();
    await c.handle("approve", "pa2");

    expect(last().status).toBe("FAILED");
    expect(last().detail).toContain("UPSTREAM_TIMEOUT");
    // Not a toast. An error — the operator may need to go and look at the target.
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("is NEVER reported as a success just because HTTP said so", async () => {
    vi.mocked(approve).mockResolvedValue({ ok: false, outcome: { status: "FAILED", toolName: "t" } });
    const { c, last } = controller();
    await c.handle("approve", "pa3");
    expect(last().status).not.toBe("EXECUTED");
  });
});

describe("the action was REFUSED — nothing ran", () => {
  it.each([
    ["EXPIRED", "This approval expired before it could run. Nothing was executed."],
    ["POLICY_DENIED", "Policy refuses this action now, even though it was approved"],
    ["INVALID_STATE", "This action already ran. Approvals are single-use."],
  ])("%s is REFUSED, not FAILED — the operator must not go hunting for a change that was never made", async (code, message) => {
    vi.mocked(approve).mockResolvedValue({ ok: false, error: { code, message } });
    const { c, last } = controller();
    await c.handle("approve", "pa4");

    expect(last().status).toBe("REFUSED");
    expect(last().detail).toContain(code);
    expect(last().detail).toContain(message);       // the reason is shown VERBATIM
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();  // nothing ran; not an error
  });
});

describe("an outcome we cannot read is not invented", () => {
  it("reports UNKNOWN rather than guessing", async () => {
    vi.mocked(approve).mockResolvedValue({ ok: false });
    const { c, last } = controller();
    await c.handle("approve", "pa5");
    expect(last().status).toBe("UNKNOWN");
    expect(last().detail).toMatch(/check the target/i);
  });
});

describe("reject", () => {
  it("says plainly that nothing was executed", async () => {
    vi.mocked(reject).mockResolvedValue({ ok: true, status: "REJECTED" });
    const { c, last } = controller();
    await c.handle("reject", "pa6");
    expect(last().status).toBe("REJECTED");
    expect(last().detail).toMatch(/nothing was executed/);
    expect(approve).not.toHaveBeenCalled();
  });
});
