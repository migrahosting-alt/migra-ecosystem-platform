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
 *
 * IT ALSO KEEPS THE RAW BYTES. Signed-assertion routes authenticate a digest of
 * the body, and a digest taken over a re-serialisation of the PARSED object is
 * not the same check: `{"n":1.0}` re-serialises to `{"n":1}`, so a body could
 * be altered in flight and still satisfy a MAC computed over the original.
 *
 * Kept HERE, in the one parser the service installs, rather than in a second
 * parser scoped to those routes — Fastify refuses a duplicate `application/json`
 * parser in a child context (FST_ERR_CTP_ALREADY_PRESENT), and that attempt
 * failed at startup on the host. Routes that need byte-exactness read
 * `request.rawBody` and REFUSE when it is absent, so this is a capability they
 * can rely on, never an assumption they make.
 */
export function installJsonBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body: string | Buffer, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    (request as { rawBody?: string }).rawBody = text;
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
