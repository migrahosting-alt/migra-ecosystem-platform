import { randomUUID } from "node:crypto";

import { panelExec } from "./db";

export const auditLog = async (opts: {
  tenantId: string;
  actorUserId: string | null;
  actionKey: string;
  resourceType: string;
  resourceId: string;
  decision: "allow" | "deny";
  beforeJson?: object;
  afterJson?: object;
}) => {
  await panelExec(
    `INSERT INTO audit_events (id, tenantid, actortype, actoruserid, actionkey, resourcetype, resourceid, decision, createdat, beforejson, afterjson)
     VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, NOW(), $8::jsonb, $9::jsonb)`,
    [
      randomUUID(),
      opts.tenantId,
      opts.actorUserId,
      opts.actionKey,
      opts.resourceType,
      opts.resourceId,
      opts.decision,
      JSON.stringify(opts.beforeJson ?? {}),
      JSON.stringify(opts.afterJson ?? {}),
    ],
  );
};