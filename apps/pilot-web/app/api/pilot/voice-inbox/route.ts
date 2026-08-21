// GET/POST /api/pilot/voice-inbox — a tiny per-session mailbox for browser voice capture.
// VS Code webviews cannot use the microphone (platform permissions-policy limitation), so
// the extension opens an external browser recorder page which transcribes locally and POSTs
// the text here keyed by a session id; the extension polls GET until the transcript appears.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entry = { text: string; at: number };
const g = globalThis as unknown as { __pilotVoiceInbox?: Map<string, Entry> };
const store: Map<string, Entry> = g.__pilotVoiceInbox ?? (g.__pilotVoiceInbox = new Map());
const TTL_MS = 10 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function gc() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { session?: string; text?: string };
  const session = typeof body.session === "string" ? body.session : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!session) return json({ error: "session required" }, 400);
  gc();
  store.set(session, { text, at: Date.now() });
  return json({ ok: true });
}

export async function GET(req: Request) {
  const session = new URL(req.url).searchParams.get("session") || "";
  if (!session) return json({ error: "session required" }, 400);
  gc();
  const entry = store.get(session);
  if (!entry) return json({ pending: true });
  store.delete(session); // single-read
  return json({ text: entry.text });
}
