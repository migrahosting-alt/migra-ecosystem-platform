/*
 * DESIGN READ — the seam that makes an attached image ACTIONABLE.
 *
 * The workspace agent holds the tools but has no vision; the qualified vision
 * model has sight but no tools. Routing an image straight to the vision model
 * therefore produced a description and nothing else: a mockup could be
 * discussed, never built.
 *
 * This stage bridges them WITHOUT giving either side the other's capability.
 * The governed vision model reads the image once and emits a literal
 * specification; that specification is plain text, so the agent loop consumes
 * it like any other instruction and keeps every tool it already had.
 *
 * The sweep instruction in step 2 is not padding: a measured read of a real
 * mockup transcribed every heading, field and button but silently dropped a
 * small number in the header corner — which the same model reported without
 * hesitation when asked for it directly. Peripheral text is what gets lost.
 *
 * The extraction prompt forbids invention on purpose. A spec is the only thing
 * the agent will see of the image — anything imagined here becomes a confident
 * lie downstream, with no picture left to check it against.
 */

import type { AiChatRequest, MigraAiClient } from '../services/migraAiClient.js';

/** Attachments as the chat surface carries them. */
export interface DesignAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
  sizeBytes?: number;
}

export const isImageAttachment = (a: { mimeType?: string }): boolean => /^image\//i.test(a.mimeType ?? '');

const EXTRACTION_PROMPT = [
  'You are reading an interface design so an engineer can rebuild it exactly.',
  'Describe ONLY what is visibly present. Do not invent screens, fields, copy, or behaviour.',
  '',
  'Report, in this order:',
  '1. Overall layout — the regions (header, sidebar, main, footer) and how they are arranged.',
  '2. Every piece of text, transcribed VERBATIM, with where it appears. Sweep the whole frame,',
  '   including corners, edges and toolbars: small or low-contrast numbers, counts, badges and',
  '   version labels are text too, and they are the first thing a hurried reader drops.',
  '3. Every control — buttons, inputs, links, icons — with its label and position.',
  '4. Colours you can actually see, described plainly (e.g. "dark purple header, white page").',
  '5. Anything ambiguous or cut off, listed explicitly as uncertain.',
  '',
  'Be literal and complete. This text is the ONLY record of the image the engineer will receive.',
].join('\n');

const COMPLETENESS_PROMPT = [
  'Below is a transcription somebody made of this image. Check it against the image.',
  '',
  'List ONLY elements that are VISIBLY PRESENT in the image but MISSING from the transcription.',
  'Do not restate what is already there. Do not add anything you cannot see.',
  'If the transcription is complete, reply with exactly: NOTHING MISSING',
  '',
  '--- transcription ---',
].join('\n');

/** The exact reply that means "complete" — compared case-insensitively, allowing punctuation. */
const NOTHING_MISSING = /^\W*nothing\s+missing\W*$/i;

/** Merge a second-read finding into the first spec, keeping the origin visible. */
export const mergeCompleteness = (spec: string, missing: string): string => {
  const extra = missing.trim();
  if (!extra || NOTHING_MISSING.test(extra)) return spec;
  return `${spec}\n\nAdditional elements found on a second read of the image:\n${extra}`;
};

/** How the derived spec is framed for the agent, so it is never mistaken for the user's own words. */
export const formatDesignSpec = (fileNames: string[], spec: string): string =>
  [
    `[Design specification derived from the attached image${fileNames.length > 1 ? 's' : ''}: ${fileNames.join(', ')}]`,
    '',
    spec.trim(),
    '',
    '[End of design specification. It was produced by a vision model reading the attachment, not typed by the user.',
    'Build against it; if it is silent on something you need, say so rather than inventing it.]',
  ].join('\n');

export interface DesignReadResult {
  /** The agent-ready specification block, already framed. */
  spec: string;
  /** The vision model that actually produced it, for provenance in the transcript. */
  model?: string;
  fileNames: string[];
}

/**
 * Read attached images with the governed vision model and return a spec the
 * agent loop can build from. Returns undefined when there is nothing to read or
 * the vision turn produced no usable text — callers then fall back to the
 * existing vision-chat path rather than entering the agent blind.
 */
export async function readAttachedDesign(
  client: Pick<MigraAiClient, 'chatStream'>,
  attachments: readonly DesignAttachment[],
  signal?: AbortSignal,
  onProgress?: (text: string) => void,
): Promise<DesignReadResult | undefined> {
  const images = attachments.filter(isImageAttachment);
  if (!images.length) return undefined;

  const request: AiChatRequest = {
    prompt: EXTRACTION_PROMPT,
    attachments: images.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      dataBase64: a.dataBase64,
      ...(a.sizeBytes === undefined ? {} : { sizeBytes: a.sizeBytes }),
    })),
    feature: 'chat',
    tier: 'balanced',
  };

  let text = '';
  let model: string | undefined;
  for await (const event of client.chatStream(request, signal)) {
    if (event.type === 'token') {
      text += event.text;
      onProgress?.(event.text);
    } else if (event.type === 'done') {
      model = event.model;
    }
  }

  const trimmed = text.trim();
  if (!trimmed) return undefined;

  /*
   * COMPLETENESS PASS — because one read is measurably not enough.
   *
   * Eight reads of the same mockup returned the full element set five times;
   * the others silently dropped whole regions (a sidebar, a card heading) at
   * essentially unchanged output length, so this is omission, not truncation.
   * The chat path exposes no temperature or seed, so the variance cannot be
   * turned down — it has to be caught.
   *
   * Asking the model what its OWN transcription is missing, with the image
   * still in front of it, is a different question from "describe this", and a
   * dropped region tends to survive the second question. A failure here is not
   * fatal: the first spec is already usable, so we keep it and move on.
   */
  let merged = trimmed;
  try {
    let second = '';
    for await (const event of client.chatStream(
      { ...request, prompt: `${COMPLETENESS_PROMPT}\n${trimmed}` },
      signal,
    )) {
      if (event.type === 'token') second += event.text;
    }
    merged = mergeCompleteness(trimmed, second);
  } catch {
    // Keep the first read. A spec that exists beats a turn that failed to start.
  }

  const fileNames = images.map((a) => a.name);
  return { spec: formatDesignSpec(fileNames, merged), model, fileNames };
}
