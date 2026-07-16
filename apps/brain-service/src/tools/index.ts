import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DiagnosticsSyncRequestSchema,
  ToolErrorSchema,
} from '@migrapilot/protocol';
import { workspaceSearch } from './workspaceSearch.js';
import { fileReadRange } from './fileReadRange.js';
import { fileReadSymbol } from './fileReadSymbol.js';
import { gitStatus } from './gitStatus.js';
import { gitDiff } from './gitDiff.js';
import { editPreview } from './editPreview.js';
import { editApply } from './editApply.js';
import { diagnosticsGet } from './diagnosticsGet.js';
import { setDiagnostics } from './diagnosticsStore.js';

function sendToolError(reply: FastifyReply, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const payload = ToolErrorSchema.parse({
    code: 'INTERNAL_ERROR',
    message,
  });

  reply.code(400).send(payload);
}

export function registerToolRoutes(app: FastifyInstance): void {
  app.post('/tools/workspace.search', async (request, reply) => {
    try {
      reply.send(await workspaceSearch(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/tools/file.readRange', async (request, reply) => {
    try {
      reply.send(await fileReadRange(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/tools/file.readSymbol', async (request, reply) => {
    try {
      reply.send(await fileReadSymbol(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/tools/git.status', async (request, reply) => {
    try {
      reply.send(await gitStatus(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/tools/git.diff', async (request, reply) => {
    try {
      reply.send(await gitDiff(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/tools/edit.preview', async (request, reply) => {
    try {
      reply.send(await editPreview(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/tools/edit.apply', async (request, reply) => {
    try {
      reply.send(await editApply(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/tools/diagnostics.get', async (request, reply) => {
    try {
      reply.send(await diagnosticsGet(request.body as never));
    } catch (error) {
      sendToolError(reply, error);
    }
  });

  app.post('/internal/diagnostics.sync', async (request, reply) => {
    try {
      const body = DiagnosticsSyncRequestSchema.parse(request.body);
      setDiagnostics(body.rootPath, body.items);
      reply.send({ ok: true, count: body.items.length });
    } catch (error) {
      sendToolError(reply, error);
    }
  });
}