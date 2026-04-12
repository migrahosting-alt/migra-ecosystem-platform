export type LogLevel = "info" | "warn" | "error";

export type MetricPoint = {
  name: string;
  value: number;
  unit?: string;
  tags?: Record<string, string>;
};

export type ErrorContext = {
  scope: string;
  message: string;
  cause?: unknown;
};

function serializeCause(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }

  if (typeof cause === "string") {
    return cause;
  }

  return undefined;
}

export function createLogger(scope: string) {
  return {
    log(level: LogLevel, message: string, extra?: Record<string, unknown>) {
      const payload = {
        timestamp: new Date().toISOString(),
        scope,
        level,
        message,
        ...extra,
      };

      console[level === "error" ? "error" : level === "warn" ? "warn" : "info"](
        JSON.stringify(payload),
      );
    },
  };
}

export function reportError(context: ErrorContext): void {
  const logger = createLogger(context.scope);

  logger.log("error", context.message, {
    cause: serializeCause(context.cause),
  });
}

export function recordMetric(point: MetricPoint): void {
  const logger = createLogger("metrics");

  logger.log("info", "metric.recorded", point);
}
