import { describe, it, expect, beforeEach } from "vitest";
import { activate } from "../../src/extension";
import { commands, Uri } from "../harness/vscodeMock";

function fakeContext(): any {
  return { subscriptions: [] as any[], extensionUri: Uri.file("/ext") };
}

describe("extension activation (scenario 1)", () => {
  beforeEach(() => { commands._registered.clear(); });

  it("S1: canonical extension activates and registers each command exactly once (no duplicates)", () => {
    expect(() => activate(fakeContext())).not.toThrow();
    const ids = [...commands._registered.keys()].sort();
    expect(ids).toEqual([
      "migrapilot.attachFile",
      "migrapilot.cancelResponse",
      "migrapilot.explainCurrentFile",
      "migrapilot.newChat",
      "migrapilot.openChat",
      "migrapilot.reviewSelection",
    ]);
  });

  it("S1b: the duplicate-registration guard actually fires on a second registration", () => {
    activate(fakeContext());
    // a second activation without disposing would double-register — must throw
    expect(() => activate(fakeContext())).toThrow(/already registered/);
  });
});
