// VS Code runs on Node 18+, which provides global fetch/TextDecoder with a
// streaming response body. @types/node ^16 doesn't declare them; loose ambient
// declarations sufficient for the streaming NDJSON client.
interface FetchBodyReader { read(): Promise<{ done: boolean; value?: Uint8Array }>; }
declare function fetch(input: string, init?: unknown): Promise<{
  ok: boolean;
  status: number;
  body: { getReader(): FetchBodyReader } | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
declare class TextDecoder { decode(input?: Uint8Array, options?: { stream?: boolean }): string; }

// Node 18+ provides AbortController/AbortSignal globally; @types/node ^16 does
// not declare them. Loose ambient declarations sufficient for cancellation.
interface AbortSignal { readonly aborted: boolean; }
declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}
