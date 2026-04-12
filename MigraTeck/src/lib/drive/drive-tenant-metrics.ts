type MetricTags = Record<string, string>;

export const DriveTenantMetricNames = {
  provisionSuccess: "migradrive_provision_success_total",
  provisionFailure: "migradrive_provision_failure_total",
  restrict: "migradrive_restrict_total",
  disable: "migradrive_disable_total",
  reactivate: "migradrive_reactivate_total",
  planChange: "migradrive_plan_change_total",
  statusDenied: "migradrive_status_denied_total",
  tenantNotFound: "migradrive_tenant_not_found_total",
  bootstrapLatencyMs: "migradrive_bootstrap_latency_ms",
  fileListLatencyMs: "migradrive_file_list_latency_ms",
  fileActionTotal: "migradrive_file_action_total",
  cleanupTriggerTotal: "migradrive_cleanup_trigger_total",
} as const;

function recordMetric(input: {
  name: string;
  value: number;
  unit?: string | undefined;
  tags?: MetricTags | undefined;
}) {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: "metrics",
      level: "info",
      message: "metric.recorded",
      ...input,
    }),
  );
}

function metric(name: string, value = 1, tags?: MetricTags) {
  recordMetric({
    name,
    value,
    unit: "count",
    tags,
  });
}

function histogram(name: string, value: number, tags?: MetricTags) {
  recordMetric({
    name,
    value,
    unit: "ms",
    tags,
  });
}

export function recordDriveProvisionSuccess(tags?: MetricTags) {
  metric(DriveTenantMetricNames.provisionSuccess, 1, tags);
}

export function recordDriveProvisionFailure(tags?: MetricTags) {
  metric(DriveTenantMetricNames.provisionFailure, 1, tags);
}

export function recordDriveRestrict(tags?: MetricTags) {
  metric(DriveTenantMetricNames.restrict, 1, tags);
}

export function recordDriveDisable(tags?: MetricTags) {
  metric(DriveTenantMetricNames.disable, 1, tags);
}

export function recordDriveReactivation(tags?: MetricTags) {
  metric(DriveTenantMetricNames.reactivate, 1, tags);
}

export function recordDrivePlanChange(tags?: MetricTags) {
  metric(DriveTenantMetricNames.planChange, 1, tags);
}

export function recordDriveStatusDenied(tags?: MetricTags) {
  metric(DriveTenantMetricNames.statusDenied, 1, tags);
}

export function recordDriveTenantNotFound(tags?: MetricTags) {
  metric(DriveTenantMetricNames.tenantNotFound, 1, tags);
}

export function recordDriveBootstrapLatency(value: number, tags?: MetricTags) {
  histogram(DriveTenantMetricNames.bootstrapLatencyMs, value, tags);
}

export function recordDriveFileListLatency(value: number, tags?: MetricTags) {
  histogram(DriveTenantMetricNames.fileListLatencyMs, value, tags);
}

export function recordDriveFileAction(action: string, tags?: MetricTags) {
  metric(DriveTenantMetricNames.fileActionTotal, 1, {
    action,
    ...tags,
  });
}

export function recordDriveCleanupTrigger(cleanedCount: number, tags?: MetricTags) {
  recordMetric({
    name: DriveTenantMetricNames.cleanupTriggerTotal,
    value: cleanedCount,
    unit: "count",
    tags,
  });
}
