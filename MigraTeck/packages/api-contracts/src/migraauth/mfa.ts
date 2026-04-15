export interface MigraAuthEnrollTotpResponse {
  challenge_id: string;
  secret: string;
  otpauth_uri: string;
  recovery_codes: string[];
  message: string;
}

export interface MigraAuthVerifyTotpRequest {
  challenge_id?: string;
  code: string;
}

export interface MigraAuthVerifyTotpResponse {
  verified: true;
  message: string;
}

export interface MigraAuthDisableMfaRequest {
  password: string;
}

export interface MigraAuthDisableMfaResponse {
  success: true;
  message: string;
}