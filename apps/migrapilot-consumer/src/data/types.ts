import type { Tone } from '@/components/ui/Badge'

export type { Tone }

export interface User {
  name: string
  email: string
  plan: 'Free' | 'Pro'
}

/* -------------------------------------------------------------------- *
 * Message content
 * Assistant answers are structured blocks rather than raw markdown so the
 * renderer stays typed and the layout matches the design exactly.
 * Inline **bold** is supported inside any string.
 * -------------------------------------------------------------------- */

export type Block =
  | { type: 'paragraph'; text: string }
  | {
      type: 'list'
      variant: 'bullet' | 'numbered'
      title?: string
      titleIcon?: 'chart' | 'rocket' | 'shield'
      items: string[]
    }

export type AttachmentKind = 'image' | 'audio' | 'document'

export interface Attachment {
  id: string
  name: string
  kind: AttachmentKind
  size: string
  /** Audio only. */
  duration?: string
  /** Image only — rendered by an inline SVG preview keyed on this id. */
  preview?: 'architecture' | 'flowchart'
  uploadedAt: 'Today' | 'Yesterday'
}

export interface Source {
  id: string
  title: string
  domain: string
  description?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  /** Plain text for user turns. */
  text?: string
  /** Structured content for assistant turns. */
  blocks?: Block[]
  time: string
  attachments?: Attachment[]
  sources?: Source[]
  /** User turns only — renders the double-check "delivered" mark. */
  delivered?: boolean
  /**
   * Content-addressed refs for images this message carries.
   *
   * BOTH ROLES. On a user turn these are the attachments they sent; on an
   * assistant turn they are images the turn GENERATED. The two are the same kind
   * of thing at this layer — a ref into the caller's own library — and treating
   * them alike is what gives a generated picture the same click-to-view,
   * lightbox and drag-out behaviour as an attached one, rather than a second
   * renderer that quietly lacks half of it.
   *
   * Refs, never bytes: the image is fetched from the caller's own library by id,
   * so a conversation reopened tomorrow shows the same picture without anything
   * having been embedded in the transcript.
   */
  images?: string[]
  /**
   * Library file names this message carried, in order.
   *
   * The document counterpart of `images`, and the same immutable record: a file
   * detached from the conversation later must still appear on the turn that
   * attached it, or the transcript disagrees with what produced the answer.
   */
  files?: string[]
  /**
   * Files from `files` that are no longer in the library.
   *
   * Rendering a deleted document exactly like a live one tells the reader the
   * source is still there to check. The card stays — the history is real — but
   * it must say the document is gone.
   */
  missingFiles?: string[]
  /** Assistant turns only — renders a call to action beneath the answer. */
  action?: 'scope-review'
  /**
   * Assistant turns only — files from the caller's own library that this answer
   * refers to. Verified against real files, so it is never a fabricated source.
   */
  citedFiles?: string[]
  /**
   * Page provenance per cited file — "page 7", "pages 7-8", or "5 pages".
   *
   * Keyed by filename so a document can never be shown with another's pages.
   * Populated from the engine's grounding frame, which is why a model told not
   * to name the file still produces correct attribution.
   */
  citedPages?: Record<string, string>
  /**
   * Assistant turns only — this is a system notice, NOT model output.
   *
   * It exists so a failed turn can never be mistaken for a generated answer.
   * The renderer must style it as a notice, and anything that treats messages
   * as model output (copy, export, summarise) must skip it.
   */
  error?: boolean
  /**
   * Assistant turns only — a REAL, COMPLETE answer that storage refused.
   *
   * This is deliberately not `error`. The two are different facts and the user
   * needs them told apart: generation failing means there is nothing to read,
   * while this means the answer is genuine and finished but will not survive a
   * reload. Discarding it would throw away work the user can still read, copy,
   * or act on; presenting it as normal would promise a persistence that did not
   * happen. So it is shown, and it is labelled.
   */
  unsaved?: boolean
}

export interface Conversation {
  id: string
  title: string
  preview: string
  time: string
  /** Sidebar bucket, derived from `updatedAt` — never assumed. */
  group: 'Today' | 'Yesterday' | 'This Week' | 'Older'
  icon: 'chat' | 'doc' | 'sheet' | 'chart' | 'mail'
  tone: Tone
  messages: Message[]
  /** Drives the right rail: media library instead of conversation tools. */
  hasMedia?: boolean
  /**
   * Images this conversation is currently about, from the Brain's durable set.
   *
   * Shown so a follow-up makes sense: after a reload the user asks "what colour
   * is it?" with nothing attached, and the interface has to make visible WHY that
   * works. An invisible durable set is indistinguishable from the model guessing.
   */
  imageRefs?: string[]
  /**
   * Documents this conversation is currently grounded in — the ACTIVE set.
   *
   * Shown for the same reason as the images, and detachable for a reason the
   * images already had: without a control, the only way to stop a document
   * answering was to delete it from the library, losing the file to get rid of
   * the context. Distinct from a message's own `files`, which is history and
   * never changes.
   */
  groundingFiles?: string[]
}

/* -------------------------------------------------------------------- *
 * Files
 * -------------------------------------------------------------------- */

export interface UploadedFile {
  id: string
  name: string
  size: string
  /** "24 pages", "Sheet1" … */
  meta: string
  status: 'ready' | 'processing' | 'error'
  pages: number
  bytes: number
}

export interface Topic {
  label: string
  tone: Tone
  icon: 'calendar' | 'sheet' | 'integration' | 'shield' | 'book'
}

/* -------------------------------------------------------------------- *
 * Governed coding runs
 * -------------------------------------------------------------------- */

export interface ScopeFile {
  path: string
  evidence: string
  detail: string
  approved: boolean
}

export interface ScopeRequest {
  approvalId: string
  expires: string
  files: ScopeFile[]
}

export type RunStepStatus = 'complete' | 'active' | 'pending'

export interface RunStep {
  id: string
  title: string
  description: string
  status: RunStepStatus
  /** Present once complete. */
  duration?: string
  /** Present while active. */
  progress?: number
}

export interface ActivityEntry {
  id: string
  time: string
  label: string
  status: 'completed' | 'in-progress' | 'pending'
}

export interface RunOutput {
  id: string
  name: string
  size: string
}

export interface ChangedFile {
  path: string
  added: number
  removed: number
}

export interface CompletedRun {
  id: string
  revision: string
  started: string
  completed: string
  duration: string
  environment: string
  filesChanged: number
  validationsPassed: number
  validationsTotal: number
  warnings: number
  linesModified: number
  fixes: string[]
  changedFiles: ChangedFile[]
}

/* -------------------------------------------------------------------- *
 * Projects, assistants, research
 * -------------------------------------------------------------------- */

export interface Project {
  id: string
  name: string
  description: string
  progress: number
  tone: Tone
  icon: 'globe' | 'trend' | 'book' | 'code'
  members: string[]
  updated: string
  starred: boolean
  files: number
  chats: number
}

export interface Assistant {
  id: string
  name: string
  description: string
  chats: number
  tone: Tone
  icon: 'pencil' | 'search' | 'code' | 'briefcase'
}

export interface ResearchStep {
  title: string
  text: string
  citations: number[]
}

export interface ResearchAnswer {
  question: string
  summary: string
  steps: ResearchStep[]
  sources: (Source & { n: number })[]
  related: string[]
}
