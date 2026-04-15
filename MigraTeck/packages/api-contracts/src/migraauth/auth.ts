export interface MigraAuthAuthUserSummary {
  id: string;
  email: string;
  status: string;
  email_verified: boolean;
  display_name?: string;
}

export interface MigraAuthSignupRequest {
  email: string;
  password: string;
  display_name?: string;
  client_id: string;
  redirect_uri: string;
}

export interface MigraAuthSignupResponse {
  user: MigraAuthAuthUserSummary;
  message: string;
}

export interface MigraAuthLoginRequest {
  email: string;
  password: string;
  client_id: string;
}

export interface MigraAuthLoginSuccessResponse {
  authenticated: true;
  requires_mfa: false;
  user: MigraAuthAuthUserSummary;
}

export interface MigraAuthLoginMfaResponse {
  authenticated: false;
  requires_mfa: true;
}

export type MigraAuthLoginResponse = MigraAuthLoginSuccessResponse | MigraAuthLoginMfaResponse;

export interface MigraAuthLogoutRequest {
  global?: boolean;
}

export interface MigraAuthLogoutResponse {
  logged_out: true;
}

export interface MigraAuthForgotPasswordRequest {
  email: string;
}

export interface MigraAuthForgotPasswordResponse {
  sent: true;
  message: string;
}

export interface MigraAuthResetPasswordRequest {
  token: string;
  password: string;
}

export interface MigraAuthResetPasswordResponse {
  success: true;
  message: string;
}

export interface MigraAuthVerifyEmailRequest {
  token: string;
}

export interface MigraAuthVerifyEmailResponse {
  success: true;
  message: string;
}

export interface MigraAuthResendVerificationRequest {
  email: string;
}

export interface MigraAuthResendVerificationResponse {
  sent: true;
  message: string;
}

export type MigraAuthRegisterRequest = MigraAuthSignupRequest;
export type MigraAuthRegisterResponse = MigraAuthSignupResponse;