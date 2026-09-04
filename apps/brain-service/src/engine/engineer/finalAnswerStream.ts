// Progressive decoding of a `{"final":"…"}` reply while it is still arriving.
//
// The agent answers ordinary chat now, and a buffered reply means the user
// stares at nothing for the whole generation — on a local 30B that reads as
// "it's stuck", which is precisely the parity gap against Copilot/Claude.
//
// The loop still parses the COMPLETE reply for correctness; what this produces
// is presentation only. It emits nothing until it is certain the reply is a
// final answer (not a tool call), so a step that turns out to be an action
// never leaks half a JSON object into the chat.

/** Opening of a final reply, tolerating whitespace and a ```json fence. */
const FINAL_PREFIX = /^\s*(?:```(?:json)?\s*)?\{\s*"final"\s*:\s*"/;

/** How much leading text may arrive before we decide this is NOT a final. A
 * fenced `{"final":"` is short; anything longer is an action or prose. */
const DECISION_WINDOW = 120;

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/',
};

export class FinalAnswerStreamer {
  private head = '';
  private state: 'deciding' | 'streaming' | 'ended' | 'not-final' = 'deciding';
  /** Trailing bytes that cannot be decoded yet (a lone `\`, a partial `\uXXXX`). */
  private partial = '';
  private emitted = '';

  /** Text emitted so far — what the client has already rendered. */
  get text(): string {
    return this.emitted;
  }

  /** True once the reply has been confirmed to be a final answer. */
  get isFinal(): boolean {
    return this.state === 'streaming' || this.state === 'ended';
  }

  /** Feed one provider delta; returns the decoded text to append (may be ''). */
  push(chunk: string): string {
    if (this.state === 'not-final' || this.state === 'ended') return '';

    if (this.state === 'deciding') {
      this.head += chunk;
      const m = FINAL_PREFIX.exec(this.head);
      if (!m) {
        // Only give up once enough has arrived that a prefix could not still be
        // forming — a chunk boundary can split `{"fin` / `al":"`.
        if (this.head.length > DECISION_WINDOW) this.state = 'not-final';
        return '';
      }
      this.state = 'streaming';
      return this.decode(this.head.slice(m[0].length));
    }
    return this.decode(chunk);
  }

  /** Decode JSON-string body text, stopping at the closing unescaped quote. */
  private decode(input: string): string {
    let src = this.partial + input;
    this.partial = '';
    let out = '';
    let i = 0;
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === '"') {
        this.state = 'ended';
        break;
      }
      if (ch !== '\\') {
        out += ch;
        i += 1;
        continue;
      }
      // An escape needs its payload; if the chunk ends mid-escape, hold it back
      // rather than emitting a stray backslash the user would see.
      if (i + 1 >= src.length) {
        this.partial = src.slice(i);
        break;
      }
      const code = src[i + 1]!;
      if (code === 'u') {
        if (i + 6 > src.length) {
          this.partial = src.slice(i);
          break;
        }
        const hex = src.slice(i + 2, i + 6);
        out += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : `\\u${hex}`;
        i += 6;
        continue;
      }
      // Models also emit escapes JSON forbids (\' most often). Passing the raw
      // character through matches what the repair pass will decide later.
      out += SIMPLE_ESCAPES[code] ?? code;
      i += 2;
    }
    this.emitted += out;
    return out;
  }
}
