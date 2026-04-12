import {
  vpsBackupsEnabled,
  vpsConsoleEnabled,
  vpsFirewallEnabled,
  vpsMonitoringEnabled,
  vpsRebuildEnabled,
  vpsSnapshotsEnabled,
  vpsSupportDiagnosticsEnabled,
} from "@/lib/env";

export const VPS_SYNC_STALE_AFTER_SECONDS = 10 * 60;

export function getVpsFeatureFlags() {
  return {
    console: vpsConsoleEnabled,
    firewall: vpsFirewallEnabled,
    snapshots: vpsSnapshotsEnabled,
    backups: vpsBackupsEnabled,
    monitoring: vpsMonitoringEnabled,
    rebuild: vpsRebuildEnabled,
    supportDiagnostics: vpsSupportDiagnosticsEnabled,
  };
}

export function isVpsSyncStale(lastSyncedAt: Date | null | undefined, staleAfterSeconds = VPS_SYNC_STALE_AFTER_SECONDS) {
  if (!lastSyncedAt) {
    return true;
  }

  return Date.now() - lastSyncedAt.getTime() > staleAfterSeconds * 1000;
}
