export class AuthCoreError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AuthCoreError";
    this.code = code;
    this.status = status;
  }
}

export function isAuthCoreError(error: unknown): error is AuthCoreError {
  return error instanceof AuthCoreError;
}