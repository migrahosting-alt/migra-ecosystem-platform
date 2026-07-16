import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';

// Deterministic in-process mock of an OpenAI-compatible /chat/completions
// streaming endpoint. The ONLY provider the P7 unit/host tests touch — no cloud,
// no real key. Records requests so correlation headers can be asserted.

export interface MockModelProviderOptions {
  requireAuth?: boolean;
  /** Non-200 status to return instead of streaming (e.g. 429, 401, 500). */
  status?: number;
  /** Delay before the first byte (to exercise client timeouts). */
  delayMs?: number;
  /** Destroy the socket after this many token frames (simulate transport loss). */
  dropAfter?: number;
  /** Tokens to stream (default ['Hello', ' world']). */
  tokens?: string[];
}

export interface RecordedProviderRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface MockModelProvider {
  url: string;
  requests: RecordedProviderRequest[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

export async function startMockModelProvider(opts: MockModelProviderOptions = {}): Promise<MockModelProvider> {
  const requests: RecordedProviderRequest[] = [];
  const tokens = opts.tokens ?? ['Hello', ' world'];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const path = (req.url ?? '').split('?')[0] ?? '';
    requests.push({ method: req.method ?? 'GET', headers: req.headers, body });

    if (path !== '/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    const hasAuth = String(req.headers['authorization'] ?? '').startsWith('Bearer ');
    if (opts.requireAuth && !hasAuth) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'missing api key', type: 'invalid_request_error' } }));
      return;
    }
    if (opts.status && opts.status !== 200) {
      res.writeHead(opts.status, {
        'content-type': 'application/json',
        'retry-after': '2',
        'x-ratelimit-remaining-requests': '0',
      });
      res.end(JSON.stringify({ error: { message: `status ${opts.status}` } }));
      return;
    }

    const start = () => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-ratelimit-limit-requests': '100',
        'x-ratelimit-remaining-requests': '97',
      });
      let i = 0;
      const pump = () => {
        if (opts.dropAfter !== undefined && i >= opts.dropAfter) {
          res.destroy(); // simulate transport loss mid-stream
          return;
        }
        if (i < tokens.length) {
          const frame = { choices: [{ delta: { content: tokens[i] } }] };
          res.write(`data: ${JSON.stringify(frame)}\n\n`);
          i += 1;
          setTimeout(pump, 3);
          return;
        }
        // Final usage frame, then [DONE].
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: tokens.length, total_tokens: 5 + tokens.length } })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      };
      pump();
    };

    if (opts.delayMs) {
      setTimeout(start, opts.delayMs);
    } else {
      start();
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
