import type { FastifyInstance } from 'fastify';

/**
 * An empty body is not a malformed body.
 *
 * Fastify's built-in JSON parser answers FST_ERR_CTP_EMPTY_JSON_BODY — surfaced
 * to the caller as a 500 "Internal server error" — for any request that declares
 * `content-type: application/json` and sends nothing. DELETE and no-argument
 * POSTs do exactly that, and a client that sets the header once for every
 * request (the normal thing to do) gets a server error for deleting a
 * conversation. The delete itself is fine; the request never reaches it.
 *
 * Found by the PostgreSQL candidate gate: `DELETE /api/ai/conversations/:id`
 * with the standard JSON header returned 500 instead of performing the
 * deletion — and a 500 on a delete is indistinguishable, from the client's side,
 * from a delete that failed.
 *
 * So: an empty body parses to `undefined`, and only genuinely malformed JSON is
 * rejected — with 400, which is what a bad body actually is.
 */
export function installJsonBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body: string | Buffer, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const error = new Error('Request body is not valid JSON.') as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });
}
