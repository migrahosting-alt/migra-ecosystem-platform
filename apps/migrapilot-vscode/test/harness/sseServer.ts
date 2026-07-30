/**
 * A REAL local HTTP server that speaks the same SSE wire format as pilot-api's
 * POST /api/pilot/chat/stream. Used so that PilotClient's real fetch + SSE
 * frame parser run end-to-end against controllable byte streams. Only the model
 * provider is faked — the transport, framing, and parser are exercised for real.
 */
import * as http from "http";
import { AddressInfo } from "net";

export interface SseFrame {
  event: string;
  data?: unknown;
  /** raw override — when set, this exact string is written as the frame body
   *  (used to inject malformed frames). */
  raw?: string;
  /** delay in ms before writing this frame (used to test cancellation). */
  delayMs?: number;
}

export interface ScenarioResponse {
  /** HTTP status; non-2xx exercises the recoverable-error path. */
  status?: number;
  /** body for a non-streaming (error) response. */
  errorBody?: string;
  /** ordered SSE frames to emit. */
  frames?: SseFrame[];
  /** keep the connection open (never send final frame) — for cancellation. */
  hang?: boolean;
}

export interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export class SseTestServer {
  private server?: http.Server;
  public readonly requests: CapturedRequest[] = [];
  private responder: (req: CapturedRequest) => ScenarioResponse = () => ({ frames: [] });

  /** Set the response the server will produce for the next request(s). */
  public respondWith(fn: ((req: CapturedRequest) => ScenarioResponse) | ScenarioResponse): void {
    this.responder = typeof fn === "function" ? fn : () => fn;
  }

  public async start(): Promise<string> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server!.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      let body: any = undefined;
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
      const captured: CapturedRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      this.requests.push(captured);

      const plan = this.responder(captured);
      const status = plan.status ?? 200;

      if (status >= 400 || plan.errorBody !== undefined) {
        res.writeHead(status, { "Content-Type": "text/plain" });
        res.end(plan.errorBody ?? `error ${status}`);
        return;
      }

      res.writeHead(status, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      let aborted = false;
      req.on("close", () => { aborted = true; });

      for (const f of plan.frames ?? []) {
        if (aborted) return;
        if (f.delayMs) await new Promise((r) => setTimeout(r, f.delayMs));
        if (aborted) return;
        if (f.raw !== undefined) { res.write(f.raw); continue; }
        res.write(`event: ${f.event}\n`);
        res.write(`data: ${JSON.stringify(f.data ?? {})}\n\n`);
      }

      if (plan.hang) return; // never end — caller aborts
      res.end();
    });
  }
}

/** Convenience: a well-formed successful chat stream for `text`, split across
 *  multiple token frames, with provider + usage + done. */
export function goodChatFrames(opts: { model?: string; reason?: string; tokens: string[]; usage?: unknown }): SseFrame[] {
  const frames: SseFrame[] = [
    { event: "conversation", data: { conversationId: "conv_test_1" } },
    { event: "provider", data: { model: opts.model ?? "gpt-oss:120b-cloud", reason: opts.reason ?? "auto" } },
  ];
  for (const t of opts.tokens) frames.push({ event: "token", data: { text: t } });
  frames.push({ event: "usage", data: opts.usage ?? { promptTokens: 10, completionTokens: 5 } });
  frames.push({ event: "done", data: { ok: true } });
  return frames;
}
