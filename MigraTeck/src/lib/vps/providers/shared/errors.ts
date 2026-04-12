export class ProviderError extends Error {
  code: string;
  retryable: boolean;
  status?: number | undefined;
  raw?: unknown;

  constructor(input: { code: string; message: string; retryable?: boolean; status?: number; raw?: unknown }) {
    super(input.message);
    this.name = "ProviderError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.status = input.status;
    this.raw = input.raw;
  }
}

export function unsupportedFeatureError(provider: string, feature: string) {
  return new ProviderError({
    code: "UNSUPPORTED_FEATURE",
    message: `${provider} does not support ${feature}.`,
    retryable: false,
  });
}

export function mapProviderError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof Error) {
    return new ProviderError({
      code: "PROVIDER_REQUEST_FAILED",
      message: `${provider} request failed: ${error.message}`,
      retryable: false,
      raw: error,
    });
  }

  return new ProviderError({
    code: "PROVIDER_REQUEST_FAILED",
    message: `${provider} request failed with an unknown error.`,
    retryable: false,
    raw: error,
  });
}
