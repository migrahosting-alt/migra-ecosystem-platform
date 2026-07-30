import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { applyProposal, rollbackProposal } from "../../src/proposedEdits/applyEngine";
import { sha256, classifyRisk } from "../../src/proposedEdits/editSafety";
import type { EditProposal, ProposalFile, RollbackPlanItem } from "../../src/proposedEdits/types";
import {
  __resetFs, __seedFile, __seedSymlink, __markDirty, __failApplyFor,
  __setTrusted, __setNoWorkspace, __readFile, __exists,
} from "../harness/vscodeMock";

function file(over: Partial<ProposalFile> & Pick<ProposalFile, "path" | "operation">): ProposalFile {
  const sensitive = over.sensitive ?? false;
  return {
    renameTo: null, originalHash: null, proposedHash: null, proposedContent: null,
    sensitive, riskClass: classifyRisk(over.operation, sensitive), ...over,
  };
}
function proposal(files: ProposalFile[]): EditProposal {
  return {
    id: "p1", workspaceId: "ws:test", title: "t", explanation: "e", status: "approved",
    riskClass: "MEDIUM", dryRun: true, files,
  };
}

beforeEach(() => { __resetFs(); });

describe("applyProposal — the real WorkspaceEdit path (scenarios 1-5,29)", () => {
  it("applies a single-file MODIFY and the on-disk content exactly equals proposedContent", async () => {
    __seedFile("src/a.ts", "old");
    const p = proposal([file({ path: "src/a.ts", operation: "modify", originalHash: sha256("old"), proposedContent: "NEW BODY" })]);
    const r = await applyProposal(p);
    expect(r.outcome).toBe("applied");
    expect(__readFile("src/a.ts")).toBe("NEW BODY");                 // diff preview == applied content
    expect(r.results[0].preApplyContent).toBe("old");                // rollback snapshot captured
    expect(r.results[0].postApplyHash).toBe(sha256("NEW BODY"));
  });

  it("applies a CREATE", async () => {
    const p = proposal([file({ path: "src/new.ts", operation: "create", proposedContent: "created" })]);
    const r = await applyProposal(p);
    expect(r.outcome).toBe("applied");
    expect(__readFile("src/new.ts")).toBe("created");
  });

  it("applies a DELETE and preserves rollback content", async () => {
    __seedFile("gone.ts", "byebye");
    const p = proposal([file({ path: "gone.ts", operation: "delete", originalHash: sha256("byebye") })]);
    const r = await applyProposal(p);
    expect(r.outcome).toBe("applied");
    expect(__exists("gone.ts")).toBe(false);
    expect(r.results[0].preApplyContent).toBe("byebye");
  });

  it("applies a RENAME (source removed, destination holds the content)", async () => {
    __seedFile("old.ts", "movable");
    const p = proposal([file({ path: "old.ts", operation: "rename", renameTo: "new.ts", originalHash: sha256("movable") })]);
    const r = await applyProposal(p);
    expect(r.outcome).toBe("applied");
    expect(__exists("old.ts")).toBe(false);
    expect(__readFile("new.ts")).toBe("movable");
  });

  it("applies a MULTI-FILE proposal atomically-preflighted", async () => {
    __seedFile("mod.ts", "m0");
    const p = proposal([
      file({ path: "created.ts", operation: "create", proposedContent: "C" }),
      file({ path: "mod.ts", operation: "modify", originalHash: sha256("m0"), proposedContent: "M1" }),
    ]);
    const r = await applyProposal(p);
    expect(r.outcome).toBe("applied");
    expect(__readFile("created.ts")).toBe("C");
    expect(__readFile("mod.ts")).toBe("M1");
  });
});

describe("applyProposal — fail-closed preflight (scenarios 10,11,12,15,16)", () => {
  const modify = (hashBasis: string) => proposal([file({ path: "src/a.ts", operation: "modify", originalHash: sha256(hashBasis), proposedContent: "X" })]);

  it("blocks when the file is dirty in the editor (scenario 10)", async () => {
    __seedFile("src/a.ts", "old"); __markDirty("src/a.ts");
    const r = await applyProposal(modify("old"));
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain("dirty:src/a.ts");
    expect(__readFile("src/a.ts")).toBe("old"); // untouched
  });

  it("blocks on a stale original hash / external change (scenarios 11,12)", async () => {
    __seedFile("src/a.ts", "SOMEONE ELSE CHANGED IT");
    const r = await applyProposal(modify("old"));
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain("stale:src/a.ts");
  });

  it("blocks when the target file is missing on disk", async () => {
    const r = await applyProposal(modify("old"));
    expect(r.reasons).toContain("missing_on_disk:src/a.ts");
  });

  it("blocks writing through a symlink (scenario 15)", async () => {
    __seedSymlink("src/a.ts", "/etc/evil");
    const r = await applyProposal(modify("old"));
    expect(r.blocked).toBe(true);
    expect(r.reasons).toContain("symlink:src/a.ts");
  });

  it("blocks a sensitive/withheld file (scenario 16)", async () => {
    __seedFile(".env", "SECRET=1");
    const p = proposal([file({ path: ".env", operation: "modify", originalHash: sha256("SECRET=1"), proposedContent: null, sensitive: true })]);
    const r = await applyProposal(p);
    expect(r.blocked).toBe(true);
    expect(r.reasons.some((x) => x.startsWith("sensitive_or_withheld"))).toBe(true);
  });

  it("blocks when the workspace is not trusted", async () => {
    __seedFile("src/a.ts", "old"); __setTrusted(false);
    const r = await applyProposal(modify("old"));
    expect(r.reasons).toContain("workspace_not_trusted");
  });

  it("blocks when there is no workspace folder", async () => {
    __setNoWorkspace();
    const r = await applyProposal(modify("old"));
    expect(r.reasons).toContain("no_workspace_folder");
  });

  it("blocks create over an existing file", async () => {
    __seedFile("exists.ts", "here");
    const r = await applyProposal(proposal([file({ path: "exists.ts", operation: "create", proposedContent: "x" })]));
    expect(r.reasons).toContain("already_exists:exists.ts");
  });
});

describe("applyProposal — partial failure reported accurately (scenario 19)", () => {
  it("stops on first failure, reports exact state, does not silently continue", async () => {
    __seedFile("a.ts", "a0"); __seedFile("b.ts", "b0"); __seedFile("c.ts", "c0");
    __failApplyFor("b.ts"); // second file's WorkspaceEdit will fail
    const p = proposal([
      file({ path: "a.ts", operation: "modify", originalHash: sha256("a0"), proposedContent: "A1" }),
      file({ path: "b.ts", operation: "modify", originalHash: sha256("b0"), proposedContent: "B1" }),
      file({ path: "c.ts", operation: "modify", originalHash: sha256("c0"), proposedContent: "C1" }),
    ]);
    const r = await applyProposal(p);
    expect(r.outcome).toBe("partial");
    expect(r.results.find((x) => x.path === "a.ts")?.applyState).toBe("applied");
    expect(r.results.find((x) => x.path === "b.ts")?.applyState).toBe("failed");
    expect(r.results.find((x) => x.path === "c.ts")?.applyState).toBe("skipped"); // never attempted
    expect(__readFile("a.ts")).toBe("A1");
    expect(__readFile("b.ts")).toBe("b0"); // failed → unchanged
    expect(__readFile("c.ts")).toBe("c0"); // skipped → unchanged
  });
});

describe("rollbackProposal — first-class + staleness-guarded (scenarios 20-24)", () => {
  async function applyAndPlan(files: ProposalFile[]): Promise<RollbackPlanItem[]> {
    const r = await applyProposal(proposal(files));
    expect(r.ok).toBe(true);
    return r.results.filter((x) => x.applyState === "applied").map((x) => {
      const f = files.find((ff) => ff.path === x.path)!;
      return { path: f.path, operation: f.operation, renameTo: f.renameTo, preApplyContent: x.preApplyContent, postApplyHash: x.postApplyHash };
    });
  }

  it("rolls back a clean MODIFY and restores the original content (scenario 20)", async () => {
    __seedFile("a.ts", "orig");
    const plan = await applyAndPlan([file({ path: "a.ts", operation: "modify", originalHash: sha256("orig"), proposedContent: "changed" })]);
    expect(__readFile("a.ts")).toBe("changed");
    const rb = await rollbackProposal(plan);
    expect(rb.ok).toBe(true);
    expect(__readFile("a.ts")).toBe("orig");
  });

  it("BLOCKS rollback if the user edited the file after apply (scenario 21)", async () => {
    __seedFile("a.ts", "orig");
    const plan = await applyAndPlan([file({ path: "a.ts", operation: "modify", originalHash: sha256("orig"), proposedContent: "changed" })]);
    __seedFile("a.ts", "USER TYPED NEW WORK"); // simulate a later user edit
    const rb = await rollbackProposal(plan);
    expect(rb.blocked).toBe(true);
    expect(rb.reasons).toContain("changed_since_apply:a.ts");
    expect(__readFile("a.ts")).toBe("USER TYPED NEW WORK"); // never overwritten
  });

  it("created-file rollback removes ONLY the created file (scenario 22)", async () => {
    __seedFile("keep.ts", "keep");
    const plan = await applyAndPlan([file({ path: "created.ts", operation: "create", proposedContent: "C" })]);
    expect(__exists("created.ts")).toBe(true);
    const rb = await rollbackProposal(plan);
    expect(rb.ok).toBe(true);
    expect(__exists("created.ts")).toBe(false);
    expect(__readFile("keep.ts")).toBe("keep"); // untouched
  });

  it("deleted-file rollback restores the original content (scenario 23)", async () => {
    __seedFile("gone.ts", "IMPORTANT");
    const plan = await applyAndPlan([file({ path: "gone.ts", operation: "delete", originalHash: sha256("IMPORTANT") })]);
    expect(__exists("gone.ts")).toBe(false);
    const rb = await rollbackProposal(plan);
    expect(rb.ok).toBe(true);
    expect(__readFile("gone.ts")).toBe("IMPORTANT");
  });

  it("rename rollback restores the original path (scenario 24)", async () => {
    __seedFile("old.ts", "body");
    const plan = await applyAndPlan([file({ path: "old.ts", operation: "rename", renameTo: "new.ts", originalHash: sha256("body") })]);
    expect(__exists("new.ts")).toBe(true);
    const rb = await rollbackProposal(plan);
    expect(rb.ok).toBe(true);
    expect(__exists("new.ts")).toBe(false);
    expect(__readFile("old.ts")).toBe("body");
  });
});

describe("no shell / git access (scenario 28)", () => {
  it("apply + rollback engine never import child_process or reference git", () => {
    const dir = path.resolve(__dirname, "../../src/proposedEdits");
    for (const f of ["applyEngine.ts", "controller.ts", "client.ts", "editSafety.ts"]) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, `${f} must not spawn processes`).not.toMatch(/child_process|execSync|\bspawn\(|simple-git|\bgit (add|commit|push|stage)/);
    }
  });
});
