import type { DriveTenantActorType, DriveTenantStatus } from "@prisma/client";

export type { DriveTenantActorType, DriveTenantStatus };

export interface DriveTenantCapabilities {
  canUpload: boolean;
  canDelete: boolean;
  canRename: boolean;
  canMove: boolean;
  canDownload: boolean;
  canPreview: boolean;
  canShare: boolean;
  readOnlyMode: boolean;
}

export interface TenantActionActor {
  actorType: DriveTenantActorType;
  actorId?: string | null | undefined;
}

export interface TenantActionContext extends TenantActionActor {
  traceId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}