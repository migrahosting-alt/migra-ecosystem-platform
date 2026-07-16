import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type ActionState, canApply, isTerminal } from '@migrapilot/pilot-client';
import { type ActionChange } from '../../services/approvalDelta.js';

// Deterministic in-process mock of pilot-api — the pilot-api analogue of the
// brain stub. Fixed responses only; no DB, no live service, no model provider.
// P4 adds a STATEFUL pending-action store (per mock instance) so approve/reject/
// resume, idempotency, single-use execution, and runId reconciliation can be
// asserted against real server-side state — never against returned `ok` values.

export type CapabilityMode =
  | 'ok'
  | 'missing'
  | 'malformed'
  | 'incompatible'
  | 'unauthorized'
  | 'no-edits'; // ok, but without the 'proposed-edits' operation class

export interface SeedAction {
  actionId: string;
  runId: string;
  state: ActionState;
  summary?: string;
  change?: ActionChange;
}

/** A fixture change carrying internal + sensitive fields to prove filtering. */
export const DEFAULT_CHANGE_FIXTURE: ActionChange = {
  op: 'update',
  resource: { type: 'file', name: 'sample.ts', id: 'res-123' },
  before: {
    mode: '0644',
    owner: 'root',
    secret: 'OLD-SECRET',
    approvalToken: 'tok-old', // internal → omitted
    runId: 'r1', // internal → omitted
    nested: { retries: 1, level: 'low' },
  },
  after: {
    mode: '0755',
    owner: 'root',
    secret: 'NEW-SECRET',
    approvalToken: 'tok-new', // internal → omitted
    runId: 'r1',
    nested: { retries: 2, level: 'low' },
    note: null, // added, value null
  },
};

export interface MockPilotApiOptions {
  requireAuth?: boolean;
  capabilities?: CapabilityMode;
  /** Milliseconds to delay every response (to exercise client timeouts). */
  delayMs?: number;
  /** Force /health/ready to report not-ready (503). */
  notReady?: boolean;
  /** Seed the pending-action store (default: one PENDING action a1/r1). */
  seedActions?: SeedAction[];
  /** Number of /runs/:id polls that report 'in_progress' after resume before
   * 'completed' — models an execution still running during reconcile. */
  runProgressPolls?: number;
  /** Execute stream drops (socket destroyed, no 'completed' frame) to simulate
   * SSE loss; the client must reconcile via runId, not treat it as failure. */
  dropExecStream?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface StoredAction {
  actionId: string;
  runId: string;
  state: ActionState;
  approvalId?: string;
  summary: string;
  change?: ActionChange;
  executionCount: number;
  runPollsRemaining: number;
}

export interface MockPilotApi {
  url: string;
  requests: RecordedRequest[];
  /** Direct store inspection — tests assert on this, not on returned `ok`. */
  getAction(actionId: string): Readonly<StoredAction> | undefined;
  executionCount(actionId: string): number;
  close(): Promise<void>;
}

const OK_CAPABILITIES = {
  protocolVersion: 1,
  serverVersion: '36.0.0-mock',
  chatTransport: 'sse',
  streaming: true,
  approvals: true,
  rejectResumeReplay: { reject: true, resume: true, replay: true },
  cancellation: true,
  correlation: { requestIdHeader: 'X-Request-Id', echoesRequestId: true },
  idempotency: {
    supported: true,
    keyHeader: 'X-Request-Id',
    scopes: ['pending-actions.approve', 'pending-actions.reject', 'pending-actions.resume', 'v1.execute'],
  },
  operationClasses: [
    'chat',
    'plan',
    'execute',
    'proposed-edits',
    'approvals',
    'replay',
    'workspace.read',
  ],
  limits: { maxRequestBytes: 1048576, maxRunDurationMs: 600000, streamIdleTimeoutMs: 60000, maxConcurrentRuns: 4 },
  deprecated: [],
  unavailable: [],
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

export async function startMockPilotApi(opts: MockPilotApiOptions = {}): Promise<MockPilotApi> {
  const capabilities = opts.capabilities ?? 'ok';
  const requests: RecordedRequest[] = [];

  // Stateful pending-action store (per mock instance).
  const seeds = opts.seedActions ?? [
    { actionId: 'a1', runId: 'r1', state: 'PENDING', summary: 'Apply patch', change: DEFAULT_CHANGE_FIXTURE },
  ];
  const actions = new Map<string, StoredAction>();
  for (const s of seeds) {
    actions.set(s.actionId, {
      actionId: s.actionId,
      runId: s.runId,
      state: s.state,
      summary: s.summary ?? 'Pending action',
      change: s.change,
      executionCount: 0,
      runPollsRemaining: 0,
    });
  }
  const idempotency = new Map<string, { status: number; body: unknown }>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const path = (req.url ?? '').split('?')[0] ?? '';
    requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });

    const send = (status: number, obj: unknown) => {
      const payload = JSON.stringify(obj);
      const finish = () => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(payload);
      };
      opts.delayMs ? setTimeout(finish, opts.delayMs) : finish();
    };

    const hasAuth = String(req.headers['authorization'] ?? '').startsWith('Bearer ');

    // /health/ready — unauthenticated reachability/readiness.
    if (path === '/health/ready') {
      if (opts.notReady) {
        return send(503, { ok: false, service: 'pilot-api', status: 'not_ready', db: 'unavailable' });
      }
      return send(200, { ok: true, service: 'pilot-api', status: 'ready', db: 'connected' });
    }

    // /api/pilot/v1/capabilities — authenticated protocol descriptor.
    if (path === '/api/pilot/v1/capabilities') {
      if (capabilities === 'unauthorized' || (opts.requireAuth && !hasAuth)) {
        return send(401, { error: 'AUTH_REQUIRED' });
      }
      if (capabilities === 'missing') {
        return send(404, { error: 'NOT_FOUND' });
      }
      if (capabilities === 'malformed') {
        // valid JSON, invalid shape (streaming is a string, no protocolVersion type)
        return send(200, { serverVersion: '36', streaming: 'yes' });
      }
      if (capabilities === 'incompatible') {
        return send(200, { ...OK_CAPABILITIES, protocolVersion: 2 });
      }
      if (capabilities === 'no-edits') {
        return send(200, {
          ...OK_CAPABILITIES,
          operationClasses: OK_CAPABILITIES.operationClasses.filter((c) => c !== 'proposed-edits'),
        });
      }
      return send(200, OK_CAPABILITIES);
    }

    // /api/pilot/proposed-edits — returns a fixed edit with correlation ids.
    if (path === '/api/pilot/proposed-edits') {
      if (opts.requireAuth && !hasAuth) {
        return send(401, { error: 'AUTH_REQUIRED' });
      }
      return send(200, {
        runId: 'r-edit-1',
        actionId: 'a-edit-1',
        proposedEdits: [
          {
            path: 'sample.ts',
            replacementRange: { startLine: 2, endLine: 2 },
            newText: '  return a + b; // fixed by pilot',
          },
        ],
      });
    }

    // /api/pilot/workspace — diagnostics ingest.
    if (path === '/api/pilot/workspace') {
      if (opts.requireAuth && !hasAuth) {
        return send(401, { error: 'AUTH_REQUIRED' });
      }
      let count = 0;
      try {
        count = (JSON.parse(body) as { items?: unknown[] })?.items?.length ?? 0;
      } catch {
        /* ignore */
      }
      return send(200, { ok: true, ingested: count });
    }

    // /api/pilot/chat/stream — deterministic SSE.
    if (path === '/api/pilot/chat/stream') {
      if (opts.requireAuth && !hasAuth) {
        return send(401, { error: 'AUTH_REQUIRED' });
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const frames = [
        `event: conversation\ndata: ${JSON.stringify({ conversationId: 'c1' })}\n\n`,
        `event: plan\ndata: ${JSON.stringify({ steps: [{ index: 0, tool: 'repo.read' }] })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ text: 'Hello' })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ text: ' world' })}\n\n`,
        `event: completed\ndata: ${JSON.stringify({ runId: 'r1', status: 'completed' })}\n\n`,
      ];
      let i = 0;
      const pump = () => {
        if (i < frames.length) {
          res.write(frames[i++]);
          setTimeout(pump, 5);
        } else {
          res.end();
        }
      };
      pump();
      return;
    }

    // Client-facing view of an action — never leaks internal counters.
    const view = (a: StoredAction) => ({
      actionId: a.actionId,
      runId: a.runId,
      state: a.state,
      approvalId: a.approvalId,
      summary: a.summary,
      change: a.change,
    });
    const idemKey = () => String(req.headers['idempotency-key'] ?? req.headers['x-request-id'] ?? '');

    // GET /api/pilot/v1/runs/:id — run state; the source of truth for reconcile.
    const runMatch = /^\/api\/pilot\/v1\/runs\/([^/]+)$/.exec(path);
    if (runMatch && req.method === 'GET') {
      if (opts.requireAuth && !hasAuth) return send(401, { error: 'AUTH_REQUIRED' });
      const runId = runMatch[1];
      const action = [...actions.values()].find((a) => a.runId === runId);
      if (!action) return send(404, { error: 'NOT_FOUND' });
      if (action.state === 'EXECUTING' && action.runPollsRemaining > 0) {
        action.runPollsRemaining -= 1;
        if (action.runPollsRemaining === 0) action.state = 'EXECUTED';
      }
      const status =
        action.state === 'EXECUTED'
          ? 'completed'
          : action.state === 'EXECUTING'
            ? 'in_progress'
            : action.state === 'REJECTED'
              ? 'rejected'
              : action.state === 'PENDING'
                ? 'pending'
                : action.state === 'APPROVED'
                  ? 'approved'
                  : 'terminal';
      return send(200, { id: runId, status, state: action.state });
    }

    // Execute progress stream — drops (no 'completed') when dropExecStream set,
    // simulating SSE loss. Execution itself is triggered by POST resume, not here.
    const execMatch = /^\/api\/pilot\/pending-actions\/([^/]+)\/execute\/stream$/.exec(path);
    if (execMatch) {
      if (opts.requireAuth && !hasAuth) return send(401, { error: 'AUTH_REQUIRED' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`event: progress\ndata: ${JSON.stringify({ pct: 50 })}\n\n`);
      if (opts.dropExecStream) {
        setTimeout(() => res.destroy(), 5);
      } else {
        setTimeout(() => {
          res.write(`event: completed\ndata: ${JSON.stringify({ runId: execMatch[1] })}\n\n`);
          res.end();
        }, 5);
      }
      return;
    }

    if (path.startsWith('/api/pilot/pending-actions')) {
      if (opts.requireAuth && !hasAuth) return send(401, { error: 'AUTH_REQUIRED' });

      if (path === '/api/pilot/pending-actions' && req.method === 'GET') {
        return send(200, { items: [...actions.values()].map(view) });
      }
      const getMatch = /^\/api\/pilot\/pending-actions\/([^/]+)$/.exec(path);
      if (getMatch && req.method === 'GET') {
        const a = actions.get(getMatch[1]!);
        return a ? send(200, view(a)) : send(404, { error: 'NOT_FOUND' });
      }
      const opMatch = /^\/api\/pilot\/pending-actions\/([^/]+)\/(approve|reject|resume)$/.exec(path);
      if (opMatch && req.method === 'POST') {
        const actionId = opMatch[1]!;
        const op = opMatch[2] as 'approve' | 'reject' | 'resume';
        const a = actions.get(actionId);
        if (!a) return send(404, { error: 'NOT_FOUND' });

        // Idempotent replay by idempotency-key / requestId — no double effect.
        const key = `${op}:${actionId}:${idemKey()}`;
        const prior = idempotency.get(key);
        if (prior) return send(prior.status, prior.body);
        const store = (status: number, bodyObj: unknown) => {
          idempotency.set(key, { status, body: bodyObj });
          return send(status, bodyObj);
        };

        const check = canApply(op, a.state);
        if (!check.ok) {
          return store(409, { error: 'INVALID_STATE', state: a.state });
        }
        if (op === 'approve') {
          a.state = 'APPROVED';
          a.approvalId = `apr-${actionId}`;
          return store(200, view(a));
        }
        if (op === 'reject') {
          a.state = 'REJECTED';
          return store(200, view(a));
        }
        // resume: bind to the EXACT server-issued approvalId, then execute once.
        let providedApproval: string | undefined;
        try {
          providedApproval = (JSON.parse(body) as { approvalId?: string }).approvalId;
        } catch {
          /* none */
        }
        if (!a.approvalId || providedApproval !== a.approvalId) {
          return store(409, { error: 'INVALID_STATE', reason: 'approvalId mismatch' });
        }
        a.executionCount += 1; // single-use execution trigger
        a.state = 'EXECUTING';
        a.runPollsRemaining = opts.runProgressPolls ?? 0;
        if (a.runPollsRemaining === 0) {
          a.state = 'EXECUTED';
        }
        return store(200, view(a));
      }
    }

    send(404, { error: 'NOT_FOUND' });
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    getAction: (actionId: string) => actions.get(actionId),
    executionCount: (actionId: string) => actions.get(actionId)?.executionCount ?? 0,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
