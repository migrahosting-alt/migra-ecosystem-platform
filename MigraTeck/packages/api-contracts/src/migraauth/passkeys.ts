import type { MigraAuthPasskeyView } from "./common";

export interface MigraAuthPasskeyRegistrationOptionsRequest {
  nickname?: string;
}

export interface MigraAuthPasskeyRegistrationOptionsResponse {
  challenge_id: string;
  options: Record<string, unknown>;
}

export interface MigraAuthPasskeyRegistrationVerifyRequest {
  challenge_id: string;
  credential: Record<string, unknown>;
  nickname?: string;
}

export interface MigraAuthPasskeyRegistrationVerifyResponse {
  passkey: MigraAuthPasskeyView;
}

export interface MigraAuthPasskeyAuthenticationOptionsRequest {
  email?: string;
}

export interface MigraAuthPasskeyAuthenticationOptionsResponse {
  challenge_id: string;
  options: Record<string, unknown>;
}

export interface MigraAuthPasskeyAuthenticationVerifyRequest {
  challenge_id: string;
  credential: Record<string, unknown>;
  device_name?: string;
}

export interface MigraAuthPasskeyAuthenticationVerifyResponse {
  verified: true;
}

export interface MigraAuthRenamePasskeyRequest {
  nickname: string;
}

export interface MigraAuthRenamePasskeyResponse {
  passkey: MigraAuthPasskeyView;
}

export interface MigraAuthRemovePasskeyResponse {
  removed: true;
}