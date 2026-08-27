/**
 * Escalating a PDF the fast path could not read.
 *
 * A PDF with a text layer is extracted inside the request, in milliseconds, and
 * keeps that route untouched. Only a document that produced NO chunks is handed
 * to the Brain's background reader, because OCR costs minutes and spending them
 * on a file already read would be pure waste.
 *
 * The decision is therefore made from evidence — the index found nothing — not
 * from the file extension.
 */

import { callBrain } from '@/server/brain/gateway'

export interface ProcessingStatus {
  fileName: string
  state:
    | 'stored' | 'processing' | 'ready' | 'ready_with_unplaced_pages'
    | 'no_text_layer' | 'ocr_failed' | 'corrupt' | 'encrypted' | 'too_large_to_process'
  stage?: string
  detail?: string
  description: string
  readable: boolean
  /** False once the state is terminal — the client must stop asking. */
  polling: boolean
  orderedPages?: number
  unplacedPages?: number
  sequenceComplete?: boolean
  failureReason?: string
}

/**
 * Ask the Brain to read a document in the background.
 *
 * Fire-and-forget from the caller's perspective, but only AFTER the Brain has
 * recorded the pending state: the upload response is what tells the user their
 * file is being read, and it must not promise work that nothing has accepted.
 */
export async function requestProcessing(fileName: string, path: string): Promise<ProcessingStatus | null> {
  const result = await callBrain<{ document?: ProcessingStatus }>({
    kind: 'processDocument',
    fileName,
    path,
  })
  return result.kind === 'ok' ? (result.value?.document ?? null) : null
}

export async function readProcessing(fileName: string): Promise<ProcessingStatus | null> {
  const result = await callBrain<{ document?: ProcessingStatus }>({
    kind: 'documentStatus',
    fileName,
  })
  return result.kind === 'ok' ? (result.value?.document ?? null) : null
}

export async function listProcessing(): Promise<ProcessingStatus[]> {
  const result = await callBrain<{ documents?: ProcessingStatus[] }>({ kind: 'documentList' })
  return result.kind === 'ok' ? (result.value?.documents ?? []) : []
}

export async function forgetProcessing(fileName: string): Promise<void> {
  await callBrain({ kind: 'documentForget', fileName }).catch(() => undefined)
}

/**
 * May this document contribute to an answer?
 *
 * 🚨 UPLOADED IS NOT SEARCHABLE. A file in `stored`, `processing`, or any failure
 * state exists in Files and contributes nothing — the whole point of reading it
 * in the background is that it is not readable yet, and letting it ground an
 * answer early would produce citations to text nobody has recovered.
 */
export function contributesToAnswers(status: ProcessingStatus | null | undefined): boolean {
  if (!status) return true // no processing record: an ordinary fast-path document
  return status.state === 'ready' || status.state === 'ready_with_unplaced_pages'
}
