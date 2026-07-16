// Approval consent-view rendering (UI-hardening slice). Renders the ACTUAL
// delta of a proposed action — not the whole object — with sensitive/internal
// fields removed, and with wording that cannot confuse a partial change for a
// full replacement. Pure and vscode-free so it is fully unit-testable.
//
// This module changes only how a pending action is DISPLAYED. Server-issued
// identifiers (approvalId, actionId, runId, requestId) are preserved on the
// PendingAction for the approve/resume calls; they are never rendered here.

// The change contract (op / resource / before / after / appended) is the wire
// shape and lives in the shared pilot-client package; this module renders it.
import type { ActionChange, ChangeOp } from '@migrapilot/pilot-client';
export type { ActionChange, ChangeOp };

export type ChangeKind = 'added' | 'removed' | 'changed' | 'appended';

export interface ConsentChangeLine {
  field: string;
  kind: ChangeKind;
  before?: string;
  after?: string;
}

export interface ConsentView {
  operationLabel: string;
  /** A sentence that makes partial-vs-full semantics unambiguous. */
  operationSemantics: string;
  resource: string;
  lines: ConsentChangeLine[];
}

const REDACTED = '‹redacted›';

// Fields that are internal/correlation/approval material — OMITTED entirely from
// the consent view (never shown, not even as a redacted placeholder).
const INTERNAL_SUBSTRINGS = [
  'approvalid',
  'approvaltoken',
  'actionid',
  'runid',
  'requestid',
  'correlationid',
  'idempotency',
  'jwt',
  'bearer',
  'authorization',
  'x-request-id',
];

// Value-sensitive fields — the field name is SHOWN (so the user knows it
// changed) but the value is REDACTED.
const SENSITIVE_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'api-key',
  'privatekey',
  'private_key',
  'private-key',
  'credential',
  'token',
];

export function isInternalField(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('_') || INTERNAL_SUBSTRINGS.some((s) => lower.includes(s));
}

export function isSensitiveValueField(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Render a leaf value for display, redacting sensitive fields. */
export function displayValue(field: string, value: unknown): string {
  if (isSensitiveValueField(field)) {
    return REDACTED;
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '(none)';
  }
  if (Array.isArray(value)) {
    return `[${value.length} item(s)]`;
  }
  if (isPlainObject(value)) {
    return '{…}';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

function equalLeaf(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compute the field-level delta between two objects. Only CHANGED fields are
 * emitted (never the whole object). Internal fields are omitted; sensitive
 * values are redacted; nested objects recurse with dotted paths. `null` (present
 * and null) is distinguished from an omitted key (which becomes 'removed').
 */
export function diffObjects(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  prefix = '',
): ConsentChangeLine[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const lines: ConsentChangeLine[] = [];

  for (const key of keys) {
    if (isInternalField(key)) {
      continue; // never displayed
    }
    const path = prefix ? `${prefix}.${key}` : key;
    const inB = Object.prototype.hasOwnProperty.call(b, key);
    const inA = Object.prototype.hasOwnProperty.call(a, key);
    const bVal = b[key];
    const aVal = a[key];

    if (inB && !inA) {
      lines.push({ field: path, kind: 'removed', before: displayValue(key, bVal) });
      continue;
    }
    if (!inB && inA) {
      lines.push({ field: path, kind: 'added', after: displayValue(key, aVal) });
      continue;
    }
    if (isPlainObject(bVal) && isPlainObject(aVal)) {
      lines.push(...diffObjects(bVal, aVal, path));
      continue;
    }
    if (!equalLeaf(bVal, aVal)) {
      lines.push({
        field: path,
        kind: 'changed',
        before: displayValue(key, bVal),
        after: displayValue(key, aVal),
      });
    }
  }
  return lines;
}

function resourceLabel(resource: ActionChange['resource']): string {
  const name = resource.name ?? resource.id ?? '(unnamed)';
  return `${resource.type} "${name}"`;
}

export function buildConsentView(change: ActionChange): ConsentView {
  const resource = resourceLabel(change.resource);
  switch (change.op) {
    case 'create':
      return {
        operationLabel: 'Create',
        operationSemantics: `Creates a new ${change.resource.type}. All fields listed below are new.`,
        resource,
        lines: diffObjects({}, change.after),
      };
    case 'update':
      return {
        operationLabel: 'Update',
        operationSemantics:
          'Partial update — only the fields listed below change; all other fields are left unchanged.',
        resource,
        lines: diffObjects(change.before, change.after),
      };
    case 'replace':
      return {
        operationLabel: 'Replace',
        operationSemantics: `Full replacement — the entire ${change.resource.type} is replaced. Any field not listed below is removed or reset.`,
        resource,
        lines: diffObjects(change.before, change.after),
      };
    case 'append':
      return {
        operationLabel: 'Append',
        operationSemantics: `Appends ${change.appended?.length ?? 0} item(s) to ${change.resource.type}; existing items are unchanged.`,
        resource,
        lines: (change.appended ?? []).map((item, i) => ({
          field: `[+${i}]`,
          kind: 'appended' as const,
          after: displayValue('item', item),
        })),
      };
    case 'delete':
      return {
        operationLabel: 'Delete',
        operationSemantics: `Deletes the entire ${change.resource.type}.`,
        resource,
        lines: diffObjects(change.before, {}),
      };
  }
}

export function renderConsentMarkdown(view: ConsentView): string {
  const out: string[] = [];
  out.push(`### ${view.operationLabel} — ${view.resource}`);
  out.push('');
  out.push(`_${view.operationSemantics}_`);
  out.push('');
  if (view.lines.length === 0) {
    out.push('_(no user-visible field changes)_');
    return out.join('\n');
  }
  out.push('| Field | Change | Before | After |');
  out.push('| --- | --- | --- | --- |');
  for (const line of view.lines) {
    out.push(`| \`${line.field}\` | ${line.kind} | ${line.before ?? '—'} | ${line.after ?? '—'} |`);
  }
  return out.join('\n');
}

/** Convenience: build + render in one step. */
export function renderActionConsent(change: ActionChange): string {
  return renderConsentMarkdown(buildConsentView(change));
}
