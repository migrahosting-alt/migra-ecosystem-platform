/**
 * Stage 2 — legacy rows to canonical normalized records.
 *
 * This is the only place that knows the legacy column layout. Everything
 * downstream works in the engine's own types, so the importer writes through the
 * same code path production uses rather than assembling SQL of its own.
 *
 * One normalization matters more than the rest, so it is stated plainly:
 *
 * THE LEGACY CHUNK ROW ID IS NOT THE LOGICAL CHUNK IDENTITY.
 *
 * SQLite stored `${indexId}:v${version}:${filePath}#${startLine}` as its row
 * primary key, while the engine's own chunk identity — the one retrieval and
 * citation use — is `${filePath}#${startLine}` (indexService.ts). PostgreSQL
 * stores the LOGICAL id in `chunk_key` and derives its row identity from
 * (owner, workspace, index, chunk_key). Carrying the legacy row id across would
 * produce chunk keys that no freshly synced index would ever reproduce, and
 * retrieval would quietly diverge for migrated indexes only.
 *
 * The logical key is therefore rebuilt from the `file_path` and `start_line`
 * COLUMNS rather than parsed out of the id string: a file path containing `:v`
 * or `#` would defeat parsing, and the columns are authoritative anyway.
 */

import type { Conversation, Message, Summary, SummaryBody } from '../../memory/conversationStore.js';
import type { PersistedChunk, PersistedIndexRecord, PersistedWorkspace } from '../types.js';
import type {
  LegacyChunkRow, LegacyConversationRow, LegacyIndexRow, LegacyMessageRow,
  LegacySummaryRow, LegacyWorkspaceRow,
} from './legacySource.js';

/** Raised when a legacy row cannot be normalized without inventing data. */
export class LegacyRecordError extends Error {
  constructor(readonly table: string, readonly id: string, detail: string) {
    super(`legacy ${table} row '${id}' cannot be normalized: ${detail}`);
    this.name = 'LegacyRecordError';
  }
}

/** The logical chunk identity the ENGINE uses — see the file header. */
export function logicalChunkKey(filePath: string, startLine: number): string {
  return `${filePath}#${startLine}`;
}

export function toConversation(r: LegacyConversationRow): Conversation {
  let groundingFiles: string[] | undefined;
  if (r.grounding_files !== null && r.grounding_files !== '') {
    try {
      const parsed: unknown = JSON.parse(r.grounding_files);
      if (!Array.isArray(parsed) || parsed.some((f) => typeof f !== 'string')) {
        throw new Error('not an array of strings');
      }
      // An empty set and "no set" are different facts; preserve which one it was.
      groundingFiles = parsed as string[];
    } catch (error) {
      throw new LegacyRecordError('conversations', r.id,
        `grounding_files is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return {
    id: r.id,
    ownerScope: r.owner_scope,
    workspaceScope: r.workspace_scope,
    title: r.title ?? '',
    memoryMode: r.memory_mode as Conversation['memoryMode'],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    ...(r.deleted_at === null ? {} : { deletedAt: Number(r.deleted_at) }),
    ...(groundingFiles === undefined ? {} : { groundingFiles }),
  };
}

export function toMessage(r: LegacyMessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as Message['role'],
    content: r.content,
    status: r.status as Message['status'],
    ...(r.request_id === null ? {} : { requestId: r.request_id }),
    ...(r.model_id === null ? {} : { modelId: r.model_id }),
    ...(r.provider_id === null ? {} : { providerId: r.provider_id }),
    createdAt: Number(r.created_at),
    // SQLite has no boolean type: `durable` is stored as 0/1 and must come back
    // as a boolean, not a truthy number, or the acknowledgement contract that
    // `durable: true` means "persisted" is compared against `1`.
    durable: Number(r.durable) === 1,
    ...(r.supersedes_id === null ? {} : { supersedesId: r.supersedes_id }),
  };
}

export function toSummary(r: LegacySummaryRow & { summary_json?: string; source_from_message_id?: string; source_to_message_id?: string }): Summary {
  let summary: SummaryBody;
  try {
    summary = JSON.parse(r.summary_json ?? '') as SummaryBody;
  } catch (error) {
    throw new LegacyRecordError('conversation_summaries', r.id,
      `summary_json is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  return {
    id: r.id,
    conversationId: r.conversation_id,
    sourceFromMessageId: r.source_from_message_id ?? '',
    sourceToMessageId: r.source_to_message_id ?? '',
    summary,
    version: Number(r.version ?? 1),
    createdAt: Number(r.created_at),
  };
}

export function toWorkspace(r: LegacyWorkspaceRow): PersistedWorkspace {
  return {
    id: r.id,
    ownerScope: r.owner_scope,
    workspaceScope: r.workspace_scope,
    name: r.name,
    root: r.root,
    ...(r.git_repo === null ? {} : { gitRepo: r.git_repo }),
    ...(r.git_branch === null ? {} : { gitBranch: r.git_branch }),
    memoryMode: r.memory_mode,
    ...(r.index_id === null ? {} : { indexId: r.index_id }),
    ...(r.provider_preferences === null ? {} : { providerPreferences: r.provider_preferences }),
    ...(r.permissions === null ? {} : { permissions: r.permissions }),
    ...(r.last_sync_at === null ? {} : { lastSyncAt: Number(r.last_sync_at) }),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function toIndexRecord(r: LegacyIndexRow): PersistedIndexRecord {
  return {
    id: r.id,
    // Despite the column name, this carries the workspace SCOPE — gate 1.8.
    workspaceId: r.workspace_id,
    ownerScope: r.owner_scope,
    sourceType: r.source_type,
    root: r.root,
    state: r.state,
    version: Number(r.version),
    approvedVersion: r.approved_version === null ? undefined : Number(r.approved_version),
    embeddingModel: r.embedding_model,
    embeddingVersion: r.embedding_version,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  } as PersistedIndexRecord;
}

/**
 * Decode a legacy vector blob.
 *
 * SQLite stored Float32 little-endian. `.slice()` is deliberate: a Buffer from
 * node:sqlite can sit at a non-zero byteOffset inside a shared ArrayBuffer, and
 * the zero-copy `new Float32Array(buf.buffer, ...)` form throws on an offset that
 * is not 4-byte aligned.
 */
export function decodeVector(blob: Uint8Array, chunkId: string): number[] {
  if (blob.byteLength === 0) throw new LegacyRecordError('index_chunks', chunkId, 'vector blob is empty');
  if (blob.byteLength % 4 !== 0) {
    throw new LegacyRecordError('index_chunks', chunkId,
      `vector blob length ${blob.byteLength} is not a multiple of 4 — not a Float32 vector`);
  }
  const view = new Float32Array(Uint8Array.from(blob).buffer);
  const out = Array.from(view);
  if (out.some((n) => !Number.isFinite(n))) {
    throw new LegacyRecordError('index_chunks', chunkId, 'vector contains a non-finite value');
  }
  return out;
}

export function toChunk(r: LegacyChunkRow): PersistedChunk {
  const startLine = Number(r.start_line);
  return {
    // The LOGICAL key, rebuilt from columns — never the legacy row id.
    id: logicalChunkKey(r.file_path, startLine),
    indexId: r.index_id,
    workspaceId: r.workspace_id,
    filePath: r.file_path,
    language: r.language ?? '',
    ...(r.symbol === null ? {} : { symbol: r.symbol }),
    startLine,
    endLine: Number(r.end_line),
    contentHash: r.content_hash,
    embeddingModel: r.embedding_model,
    embeddingVersion: r.embedding_version,
    indexedAt: Number(r.indexed_at),
    text: r.text,
    vector: decodeVector(r.vector, `${r.index_id}:${r.file_path}#${startLine}`),
  };
}
