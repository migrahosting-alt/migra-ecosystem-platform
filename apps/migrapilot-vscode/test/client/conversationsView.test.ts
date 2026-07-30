/**
 * D.2 — the Conversations panel.
 *
 * The backend had grown far past the UI: conversations were persisted, titled, resumable,
 * pinnable and searchable — and the only way to reach any of it was a QuickPick you had to
 * know the name of. The operator could not SEE their own history. A capability nobody can
 * find is a capability nobody has.
 *
 * The grouping is pure so it can be tested against a fixed clock, without a UI.
 */

import { describe, it, expect } from "vitest";
import { bucketFor, groupConversations, relativeTime, describeConversation, BUCKET_ORDER } from "../../src/conversationsView";
import type { ConversationSummary } from "../../src/pilotClient";

const NOW = new Date("2026-07-12T15:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000, DAY = 86_400_000;

const c = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: "c1", title: "A thread", createdAt: ago(30 * DAY), lastActiveAt: ago(HOUR),
  messageCount: 4, ...over,
});

describe("grouping — how an engineer scans history", () => {
  it("pinned beats recency: it is a deliberate act, not a timestamp", () => {
    expect(bucketFor(c({ pinned: true, lastActiveAt: ago(90 * DAY) }), NOW)).toBe("Pinned");
  });

  it("buckets by LAST ACTIVITY, not creation — a month-old thread touched an hour ago is Today", () => {
    expect(bucketFor(c({ createdAt: ago(60 * DAY), lastActiveAt: ago(HOUR) }), NOW)).toBe("Today");
  });

  it.each([
    [HOUR, "Today"],
    [26 * HOUR, "Yesterday"],
    [3 * DAY, "Earlier this week"],
    [30 * DAY, "Older"],
  ] as const)("%i ms ago -> %s", (age, bucket) => {
    expect(bucketFor(c({ lastActiveAt: ago(age) }), NOW)).toBe(bucket);
  });

  it("a junk timestamp lands in Older rather than throwing", () => {
    expect(bucketFor({ lastActiveAt: "not-a-date" }, NOW)).toBe("Older");
  });

  it("renders buckets in reading order and drops the empty ones — noise is not structure", () => {
    const g = groupConversations([
      c({ id: "old", lastActiveAt: ago(40 * DAY) }),
      c({ id: "pin", pinned: true, lastActiveAt: ago(40 * DAY) }),
      c({ id: "now", lastActiveAt: ago(HOUR) }),
    ], NOW);
    expect(g.map((x) => x.bucket)).toEqual(["Pinned", "Today", "Older"]); // no Yesterday, no Earlier
    expect(BUCKET_ORDER.indexOf("Pinned")).toBe(0);
  });

  it("inside a bucket, most-recently-active first", () => {
    const g = groupConversations([
      c({ id: "older", lastActiveAt: ago(5 * HOUR) }),
      c({ id: "newer", lastActiveAt: ago(1 * HOUR) }),
    ], NOW);
    expect(g[0].items.map((i) => i.id)).toEqual(["newer", "older"]);
  });
});

describe("what each row says", () => {
  it("names where it happened and when it was last touched", () => {
    const d = describeConversation(c({ workspace: "migrapilot-vscode", branch: "main", lastActiveAt: ago(3 * 60_000) }), NOW);
    expect(d).toBe("migrapilot-vscode on main · 3 minutes ago");
  });

  it("degrades cleanly when a conversation has no project attached", () => {
    expect(describeConversation(c({ workspace: null, branch: null, lastActiveAt: ago(HOUR) }), NOW)).toBe("1 hour ago");
  });

  it.each([
    [30_000, "just now"],
    [5 * 60_000, "5 minutes ago"],
    [2 * HOUR, "2 hours ago"],
    [3 * DAY, "3 days ago"],
  ] as const)("relativeTime(%i) -> %s", (age, out) => {
    expect(relativeTime(ago(age), NOW)).toBe(out);
  });
});
