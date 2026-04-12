import { OrgRole, VpsActionType, VpsProviderHealthState, VpsServerMemberRole } from "@prisma/client";

export type VpsRole = VpsServerMemberRole;

export interface VpsCapabilities {
  canView: boolean;
  canOpenConsole: boolean;
  canReboot: boolean;
  canPowerControl: boolean;
  canRescue: boolean;
  canRebuild: boolean;
  canManageFirewall: boolean;
  canManageSnapshots: boolean;
  canManageBackups: boolean;
  canViewBilling: boolean;
  canManageBilling: boolean;
  canOpenSupport: boolean;
  canManageSettings: boolean;
}

export function mapOrgRoleToVpsRole(role: OrgRole): VpsRole {
  switch (role) {
    case OrgRole.OWNER:
      return VpsServerMemberRole.OWNER;
    case OrgRole.ADMIN:
      return VpsServerMemberRole.ADMIN;
    case OrgRole.BILLING:
      return VpsServerMemberRole.BILLING;
    case OrgRole.MEMBER:
      return VpsServerMemberRole.OPERATOR;
    case OrgRole.READONLY:
    default:
      return VpsServerMemberRole.READ_ONLY;
  }
}

export function resolveServerScopedRole(orgRole: OrgRole, serverRole?: VpsRole | null) {
  return serverRole || mapOrgRoleToVpsRole(orgRole);
}

export function getVpsCapabilities(role: VpsRole): VpsCapabilities {
  switch (role) {
    case VpsServerMemberRole.OWNER:
      return {
        canView: true,
        canOpenConsole: true,
        canReboot: true,
        canPowerControl: true,
        canRescue: true,
        canRebuild: true,
        canManageFirewall: true,
        canManageSnapshots: true,
        canManageBackups: true,
        canViewBilling: true,
        canManageBilling: true,
        canOpenSupport: true,
        canManageSettings: true,
      };
    case VpsServerMemberRole.ADMIN:
      return {
        canView: true,
        canOpenConsole: true,
        canReboot: true,
        canPowerControl: true,
        canRescue: true,
        canRebuild: true,
        canManageFirewall: true,
        canManageSnapshots: true,
        canManageBackups: true,
        canViewBilling: true,
        canManageBilling: false,
        canOpenSupport: true,
        canManageSettings: true,
      };
    case VpsServerMemberRole.OPERATOR:
      return {
        canView: true,
        canOpenConsole: true,
        canReboot: true,
        canPowerControl: true,
        canRescue: true,
        canRebuild: false,
        canManageFirewall: false,
        canManageSnapshots: true,
        canManageBackups: true,
        canViewBilling: false,
        canManageBilling: true,
        canOpenSupport: false,
        canManageSettings: false,
      };
    case VpsServerMemberRole.SUPPORT_VIEWER:
      return {
        canView: true,
        canOpenConsole: false,
        canReboot: false,
        canPowerControl: false,
        canRescue: false,
        canRebuild: false,
        canManageFirewall: false,
        canManageSnapshots: false,
        canManageBackups: false,
        canViewBilling: false,
        canManageBilling: false,
        canOpenSupport: true,
        canManageSettings: false,
      };
    case VpsServerMemberRole.BILLING:
      return {
        canView: true,
        canOpenConsole: false,
        canReboot: false,
        canPowerControl: false,
        canRescue: false,
        canRebuild: false,
        canManageFirewall: false,
        canManageSnapshots: false,
        canManageBackups: false,
        canViewBilling: true,
        canManageBilling: true,
        canOpenSupport: false,
        canManageSettings: false,
      };
    case VpsServerMemberRole.READ_ONLY:
    default:
      return {
        canView: true,
        canOpenConsole: false,
        canReboot: false,
        canPowerControl: false,
        canRescue: false,
        canRebuild: false,
        canManageFirewall: false,
        canManageSnapshots: false,
        canManageBackups: false,
        canViewBilling: true,
        canManageBilling: false,
        canOpenSupport: true,
        canManageSettings: false,
      };
  }
}

const actionRoles: Record<VpsActionType, VpsRole[]> = {
  POWER_ON: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  POWER_OFF: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  REBOOT: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  HARD_REBOOT: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  ENABLE_RESCUE: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  DISABLE_RESCUE: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  REBUILD: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN],
  OPEN_CONSOLE_SESSION: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  CREATE_SNAPSHOT: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
  RESTORE_SNAPSHOT: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN],
  DELETE_SNAPSHOT: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN],
  UPDATE_FIREWALL: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN],
  ROLLBACK_FIREWALL: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN],
  UPDATE_BACKUP_POLICY: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN],
  MANUAL_SYNC: [VpsServerMemberRole.OWNER, VpsServerMemberRole.ADMIN, VpsServerMemberRole.OPERATOR],
};

const blockedWhenDegraded = new Set<VpsActionType>([
  VpsActionType.POWER_OFF,
  VpsActionType.HARD_REBOOT,
  VpsActionType.ENABLE_RESCUE,
  VpsActionType.DISABLE_RESCUE,
  VpsActionType.REBUILD,
  VpsActionType.RESTORE_SNAPSHOT,
  VpsActionType.DELETE_SNAPSHOT,
  VpsActionType.UPDATE_FIREWALL,
  VpsActionType.ROLLBACK_FIREWALL,
  VpsActionType.UPDATE_BACKUP_POLICY,
]);

export function getRequiredRolesForAction(action: VpsActionType): VpsRole[] {
  return actionRoles[action];
}

export function roleMeetsRequirement(actualRole: VpsRole, allowedRoles: VpsRole[]) {
  return allowedRoles.includes(actualRole);
}

export function getControlPlaneRestriction(input: {
  providerHealthState: VpsProviderHealthState;
  action: VpsActionType;
}) {
  if (input.providerHealthState === VpsProviderHealthState.UNREACHABLE) {
    return {
      blocked: true,
      reason: "Provider unavailable.",
      policy: "UNREACHABLE_PROVIDER",
    } as const;
  }

  if (input.providerHealthState === VpsProviderHealthState.DEGRADED && blockedWhenDegraded.has(input.action)) {
    return {
      blocked: true,
      reason: "Provider is degraded. This action is blocked while the server is in safe mode.",
      policy: "DEGRADED_SAFE_MODE",
    } as const;
  }

  return {
    blocked: false,
  } as const;
}
