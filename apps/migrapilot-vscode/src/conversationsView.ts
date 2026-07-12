/**
 * D.2 — the Conversations panel.
 *
 * The backend had grown far past the UI: conversations were persisted, titled, resumable,
 * pinnable and searchable, and the only way to reach any of it was a QuickPick you had to
 * know the name of. The operator could not SEE their own history. A capability nobody can
 * find is a capability nobody has.
 *
 * This is a real tree in the MigraPilot view container, grouped the way an engineer
 * actually scans history:
 *
 *   ⭐ Pinned
 *   🕒 Today
 *      Yesterday
 *      Earlier this week
 *      Older
 *
 * Each item carries where it happened — workspace, branch, model — because a conversation
 * is about a PROJECT, not a floating chat. Sorted by LAST ACTIVITY, not creation: a
 * month-old thread you touched five minutes ago belongs at the top.
 */

import * as vscode from "vscode";
import type { ConversationSummary, PilotClient } from "./pilotClient";

/* ── grouping ───────────────────────────────────────────────────────────────── */

export type Bucket = "Pinned" | "Today" | "Yesterday" | "Earlier this week" | "Older";

const DAY = 86_400_000;

/** Pure, so the grouping is testable without a clock or a UI. */
export function bucketFor(c: { pinned?: boolean; lastActiveAt: string }, now = Date.now()): Bucket {
  if (c.pinned) return "Pinned";
  const t = Date.parse(c.lastActiveAt);
  if (!Number.isFinite(t)) return "Older";

  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY) return "Yesterday";
  if (t >= startOfToday - 6 * DAY) return "Earlier this week";
  return "Older";
}

export const BUCKET_ORDER: Bucket[] = ["Pinned", "Today", "Yesterday", "Earlier this week", "Older"];

/** Group and order for display. Empty buckets are not rendered — noise, not structure. */
export function groupConversations(
  items: ConversationSummary[],
  now = Date.now(),
): Array<{ bucket: Bucket; items: ConversationSummary[] }> {
  const map = new Map<Bucket, ConversationSummary[]>();
  for (const c of items) {
    const b = bucketFor(c, now);
    (map.get(b) ?? map.set(b, []).get(b)!).push(c);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""));
  }
  return BUCKET_ORDER.filter((b) => map.get(b)?.length).map((b) => ({ bucket: b, items: map.get(b)! }));
}

/** "3 minutes ago". An engineer reads recency, not ISO timestamps. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString();
}

/** The one-line subtitle: where it happened, and when it was last touched. */
export function describeConversation(c: ConversationSummary, now = Date.now()): string {
  const where = [c.workspace, c.branch && `on ${c.branch}`].filter(Boolean).join(" ");
  const when = relativeTime(c.lastActiveAt, now);
  return [where, when].filter(Boolean).join(" · ");
}

/* ── the tree ───────────────────────────────────────────────────────────────── */

type Node = { kind: "bucket"; bucket: Bucket } | { kind: "conversation"; item: ConversationSummary };

export class ConversationsProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private items: ConversationSummary[] = [];
  private error: string | null = null;
  private filter = "";
  /** The thread currently open in the chat panel, highlighted in the tree. */
  private activeId: string | undefined;

  constructor(private readonly client: PilotClient) {}

  setActive(id: string | undefined): void {
    if (id === this.activeId) return;
    this.activeId = id;
    this._onDidChange.fire();
  }

  setFilter(q: string): void {
    this.filter = q.trim().toLowerCase();
    this._onDidChange.fire();
  }

  get currentFilter(): string {
    return this.filter;
  }

  async refresh(): Promise<void> {
    try {
      this.items = await this.client.listConversations();
      this.error = null;
    } catch (err) {
      // Say WHY the list is empty. A blank panel that means "the server is down" and a blank
      // panel that means "you have no conversations" must not look the same.
      this.items = [];
      this.error = (err as Error)?.message ?? String(err);
    }
    this._onDidChange.fire();
  }

  private visible(): ConversationSummary[] {
    if (!this.filter) return this.items;
    return this.items.filter((c) =>
      [c.title, c.preview, c.workspace, c.branch, c.model, ...(c.tags ?? [])]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(this.filter)),
    );
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return groupConversations(this.visible()).map((g) => ({ kind: "bucket", bucket: g.bucket }));
    }
    if (node.kind === "bucket") {
      const g = groupConversations(this.visible()).find((x) => x.bucket === node.bucket);
      return (g?.items ?? []).map((item) => ({ kind: "conversation", item }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "bucket") {
      const t = new vscode.TreeItem(node.bucket, vscode.TreeItemCollapsibleState.Expanded);
      t.iconPath = new vscode.ThemeIcon(node.bucket === "Pinned" ? "star-full" : "history");
      t.contextValue = "migrapilot.bucket";
      return t;
    }

    const c = node.item;
    const t = new vscode.TreeItem(c.title, vscode.TreeItemCollapsibleState.None);
    t.id = c.id;
    t.description = describeConversation(c);
    t.tooltip = new vscode.MarkdownString(
      [
        `**${c.title}**`,
        "",
        c.preview ? `_${c.preview}_` : "",
        "",
        `| | |`,
        `|---|---|`,
        c.workspace ? `| Workspace | ${c.workspace} |` : "",
        c.repository ? `| Repository | ${c.repository} |` : "",
        c.branch ? `| Branch | \`${c.branch}\` |` : "",
        c.model ? `| Model | \`${c.model}\` |` : "",
        `| Messages | ${c.messageCount} |`,
        `| Last active | ${relativeTime(c.lastActiveAt)} |`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const active = c.id === this.activeId;
    t.iconPath = new vscode.ThemeIcon(
      c.pinned ? "star-full" : active ? "comment-discussion" : "comment",
      active ? new vscode.ThemeColor("charts.blue") : undefined,
    );
    // contextValue drives which menu items appear — pin vs unpin.
    t.contextValue = c.pinned ? "migrapilot.conversation.pinned" : "migrapilot.conversation";
    t.command = {
      command: "migrapilot.resumeConversation",
      title: "Resume",
      arguments: [c.id],
    };
    return t;
  }

  /** Rendered when the tree is empty — VS Code shows this via viewsWelcome, but the error
   *  case needs a voice, so it is surfaced as a message too. */
  get lastError(): string | null {
    return this.error;
  }
}
