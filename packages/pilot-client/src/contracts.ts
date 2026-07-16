// pilot-api change contract — the typed shape of a proposed action's delta as
// issued by pilot-api. These are PROTOCOL types (what the wire carries); how a
// change is rendered for human consent is a UI concern and lives with the
// consumer (see the extension's approvalDelta renderer), not here.

export type ChangeOp = 'create' | 'update' | 'delete' | 'append' | 'replace';

export interface ActionChange {
  op: ChangeOp;
  resource: { type: string; id?: string; name?: string };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  appended?: unknown[];
}
