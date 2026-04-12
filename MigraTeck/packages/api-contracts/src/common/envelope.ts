export interface ApiErrorPayload {
  code: string;
  message: string;
}

export interface ApiSuccessEnvelope<T> {
  ok: true;
  data: T;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: ApiErrorPayload;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export function successEnvelope<T>(data: T): ApiSuccessEnvelope<T> {
  return {
    ok: true,
    data,
  };
}

export function errorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}