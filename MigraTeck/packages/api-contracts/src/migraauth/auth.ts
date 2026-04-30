export interface MigraAuthSessionSummary {
  id: string;
  created_at: string;
  expires_at: string;
  last_seen_at?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface MigraAuthAuthUserSummary {
  id: string;
  email: string | null;
  phone_e164: string | null;
  status: string;
  email_verified: boolean;
  phone_verified: boolean;
  display_name?: string;
}

export interface MigraAuthSignupRequest {
  identifier: string;
  password: string;
  display_name?: string;
  client_id: string;
  redirect_uri: string;
}

export interface MigraAuthSignupResponse {
  user: MigraAuthAuthUserSummary;
  challenge_id: string;
  channel: "email" | "sms";
  masked_destination: string;
  expires_in_seconds: number;
  resend_after_seconds: number;
  message: string;
}

export interface MigraAuthSignupVerifyRequest {
  challenge_id: string;
  code: string;
}

export interface MigraAuthSignupVerifyResponse {
  authenticated: true;
  user: MigraAuthAuthUserSummary;
  session: MigraAuthSessionSummary;
}

export interface MigraAuthLoginRequest {
  identifier: string;
  password: string;
  client_id: string;
}

export interface MigraAuthLoginSuccessResponse {
  authenticated: true;
  requires_mfa: false;
  user: MigraAuthAuthUserSummary;
  session: MigraAuthSessionSummary;
}

export interface MigraAuthLoginVerificationRequiredResponse {
  status: "verification_required";
  challenge_id: string;
  channel: "email" | "sms";
  masked_destination: string;
  message: string;
}

export interface MigraAuthLoginMfaResponse {
  authenticated: false;
  requires_mfa: true;
}

export type MigraAuthLoginResponse =
  | MigraAuthLoginSuccessResponse
  | MigraAuthLoginVerificationRequiredResponse
  | MigraAuthLoginMfaResponse;

export interface MigraAuthRefreshResponse {
  authenticated: true;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  user: MigraAuthAuthUserSummary;
  session: MigraAuthSessionSummary;
}

export interface MigraAuthMeResponse {
  authenticated: true;
  user: MigraAuthAuthUserSummary;
  session: MigraAuthSessionSummary | null;
}

export interface MigraAuthLogoutRequest {
  global?: boolean;
}

export interface MigraAuthLogoutResponse {
  logged_out: true;
}

export interface MigraAuthForgotPasswordRequest {
  identifier: string;
  client_id?: string;
}

export interface MigraAuthForgotPasswordResponse {
  sent: true;
  message: string;
  challenge_id?: string;
  channel?: "sms";
  masked_destination?: string;
}

export interface MigraAuthResetPasswordRequest {
  token?: string;
  challenge_id?: string;
  code?: string;
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
  challenge_id?: string;
  identifier?: string;
}

export interface MigraAuthResendVerificationResponse {
  sent: true;
  message: string;
  challenge_id?: string;
  channel?: "email" | "sms";
  masked_destination?: string;
  resend_after_seconds?: number;
}

export type MigraAuthRegisterRequest = MigraAuthSignupRequest;
export type MigraAuthRegisterResponse = MigraAuthSignupResponse;
