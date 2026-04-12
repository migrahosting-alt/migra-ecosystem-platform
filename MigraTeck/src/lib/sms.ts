import { env, authSmsBrandName, authSmsCodeTtlSeconds, authSmsFromNumber } from "@/lib/env";
import { normalizeUsPhoneNumber } from "@/lib/phone";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

type SmsResponse = {
  id: string;
  payload: Record<string, unknown> | null;
};

export async function sendSmsMessage(input: { to: string; text: string; from?: string }): Promise<SmsResponse> {
  if (!env.TELNYX_API_KEY) {
    throw new Error("TELNYX_API_KEY is not configured.");
  }

  const response = await fetch(`${TELNYX_API_BASE}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: normalizeUsPhoneNumber(input.from || authSmsFromNumber),
      to: normalizeUsPhoneNumber(input.to),
      text: input.text,
      ...(env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = typeof payload?.errors === "object" ? JSON.stringify(payload.errors) : response.statusText;
    throw new Error(`Telnyx send failed: ${detail}`);
  }

  const data = payload?.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
  const id = typeof data?.id === "string" ? data.id : null;
  if (!id) {
    throw new Error("Telnyx send failed: missing message id.");
  }

  return { id, payload };
}

export async function sendAuthLoginCodeSms(input: { to: string; code: string }) {
  const expiresInMinutes = Math.max(1, Math.ceil(authSmsCodeTtlSeconds / 60));
  return sendSmsMessage({
    to: input.to,
    text: `${authSmsBrandName} sign-in code: ${input.code}. Expires in ${expiresInMinutes} minutes. Reply STOP to opt out, HELP for help.`,
  });
}