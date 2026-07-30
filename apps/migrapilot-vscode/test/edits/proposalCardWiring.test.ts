import { describe, it, expect, vi } from "vitest";
import { ChatPanelViewProvider, type ChatHandlers, type ProposalCard } from "../../src/chatPanelView";
import { proposalCommandFor } from "../../src/extension";
import { Uri } from "../harness/vscodeMock";

/**
 * Verifies the proposal-card message protocol between the extension host and the
 * chat webview, and that card buttons dispatch the correct Phase C commands.
 * The webview DOM runs in VS Code; here we drive the host side of the boundary.
 */

function makeHandlers(over: Partial<ChatHandlers> = {}): ChatHandlers {
  return {
    onUserMessage: vi.fn(), onSetModel: vi.fn(), onMention: vi.fn(), onAttach: vi.fn(),
    onSettings: vi.fn(), onRemoveChip: vi.fn(), onPasteImage: vi.fn(), onUploadFile: vi.fn(),
    onVoiceCapture: vi.fn(), onProposalAction: vi.fn(), ...over,
  };
}

/** Minimal fake WebviewView capturing posted messages + the inbound callback. */
function fakeView() {
  const posted: any[] = [];
  let inbound: (msg: any) => void = () => {};
  const view: any = {
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-resource:",
      asWebviewUri: (u: any) => u,
      onDidReceiveMessage: (cb: any) => { inbound = cb; return { dispose() {} }; },
      postMessage: (m: any) => { posted.push(m); return Promise.resolve(true); },
    },
    onDidDispose: (_cb: any) => ({ dispose() {} }),
    show: () => {},
  };
  return { view, posted, send: (m: any) => inbound(m) };
}

const CARD: ProposalCard = {
  proposalId: "pe_1", title: "Refactor parseConfig", model: "gpt-oss:120b-cloud",
  filesAffected: 2, linesAdded: 12, linesRemoved: 5, risk: "MEDIUM",
  summary: "split into helpers", expiresAt: new Date(Date.now() + 3600e3).toISOString(),
  destructive: false, sensitive: false,
};

describe("proposal card host↔webview protocol", () => {
  it("posts a proposalCard message carrying the full metadata", () => {
    const { view, posted, send } = fakeView();
    const p = new ChatPanelViewProvider(Uri.file("/ext"), makeHandlers());
    p.resolveWebviewView(view);
    send({ command: "ready" });
    p.proposalCard(CARD);
    const msg = posted.find((m) => m.command === "proposalCard");
    expect(msg).toBeTruthy();
    expect(msg.card).toMatchObject({ proposalId: "pe_1", filesAffected: 2, linesAdded: 12, linesRemoved: 5, risk: "MEDIUM" });
  });

  it("posts proposalStatus updates reflecting the state machine", () => {
    const { view, posted, send } = fakeView();
    const p = new ChatPanelViewProvider(Uri.file("/ext"), makeHandlers());
    p.resolveWebviewView(view);
    send({ command: "ready" });
    p.proposalStatus("pe_1", "approved");
    p.proposalStatus("pe_1", "rollback_available", "applied 2 files");
    const statuses = posted.filter((m) => m.command === "proposalStatus");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ id: "pe_1", status: "approved" });
    expect(statuses[1]).toMatchObject({ id: "pe_1", status: "rollback_available", detail: "applied 2 files" });
  });

  it("routes a card button click to onProposalAction", () => {
    const onProposalAction = vi.fn();
    const { view, send } = fakeView();
    const p = new ChatPanelViewProvider(Uri.file("/ext"), makeHandlers({ onProposalAction }));
    p.resolveWebviewView(view);
    send({ command: "proposalAction", action: "approve", id: "pe_1" });
    expect(onProposalAction).toHaveBeenCalledWith("approve", "pe_1");
  });

  it("ignores a proposalAction with a missing id or action", () => {
    const onProposalAction = vi.fn();
    const { view, send } = fakeView();
    const p = new ChatPanelViewProvider(Uri.file("/ext"), makeHandlers({ onProposalAction }));
    p.resolveWebviewView(view);
    send({ command: "proposalAction", action: "approve" });
    send({ command: "proposalAction", id: "pe_1" });
    expect(onProposalAction).not.toHaveBeenCalled();
  });
});

describe("card buttons map to the existing Phase C commands", () => {
  it("maps every action to its registered command", () => {
    expect(proposalCommandFor("review")).toBe("migrapilot.reviewProposedEdit");
    expect(proposalCommandFor("approve")).toBe("migrapilot.approveProposedEdit");
    expect(proposalCommandFor("reject")).toBe("migrapilot.rejectProposedEdit");
    expect(proposalCommandFor("apply")).toBe("migrapilot.applyProposedEdit");
    expect(proposalCommandFor("rollback")).toBe("migrapilot.rollbackProposedEdit");
  });
});
