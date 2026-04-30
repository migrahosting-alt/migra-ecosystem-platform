import { sendPasswordResetEmail, sendVerificationEmail } from "./email.js";
import { config } from "../config/env.js";
import { maskIdentifier } from "./identifier.js";

type SmsReason = "signup_verification" | "password_reset";

function maskPhoneNumber(destination: string): string {
  return maskIdentifier({ kind: "PHONE", normalized: destination });
}

function assertSmsEnabledOutsideDevelopment(): void {
  if (config.smsProvider === "console" && !config.isDev) {
    throw new Error("AUTH_SMS_PROVIDER=console is not allowed outside development.");
  }
}

function assertTwilioConfig(): void {
  const { accountSid, authToken, fromNumber, messagingServiceSid } = config.sms.twilio;
  if (!accountSid || !authToken) {
    throw new Error("Twilio SMS delivery requires AUTH_SMS_TWILIO_ACCOUNT_SID and AUTH_SMS_TWILIO_AUTH_TOKEN.");
  }
  if (!fromNumber && !messagingServiceSid) {
    throw new Error("Twilio SMS delivery requires AUTH_SMS_TWILIO_FROM_NUMBER or AUTH_SMS_TWILIO_MESSAGING_SERVICE_SID.");
  }
}

function assertTestLaneConfig(destination: string): void {
  const { url, apiKey, allowedNumbers } = config.sms.testLane;
  if (!url || !apiKey) {
    throw new Error("Test-lane SMS delivery requires AUTH_SMS_TEST_LANE_URL and AUTH_SMS_TEST_LANE_API_KEY.");
  }
  if (allowedNumbers.length === 0) {
    throw new Error("Test-lane SMS delivery requires AUTH_SMS_TEST_LANE_ALLOWED_NUMBERS.");
  }
  if (!allowedNumbers.includes(destination)) {
    throw new Error(`Phone number ${maskPhoneNumber(destination)} is not approved for the configured SMS test lane.`);
  }
}

async function sendTwilioSms(input: {
  destination: string;
  body: string;
  reason: SmsReason;
}): Promise<void> {
  assertTwilioConfig();

  const { accountSid, authToken, fromNumber, messagingServiceSid, statusCallbackUrl } = config.sms.twilio;
  const payload = new URLSearchParams({
    To: input.destination,
    Body: input.body,
  });

  if (fromNumber) {
    payload.set("From", fromNumber);
  }
  if (messagingServiceSid) {
    payload.set("MessagingServiceSid", messagingServiceSid);
  }
  if (statusCallbackUrl) {
    payload.set("StatusCallback", statusCallbackUrl);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Twilio SMS delivery failed (${response.status}): ${details}`);
  }

  const result = await response.json() as { sid?: string };
  console.info(
    `[migraauth] sms sent provider=twilio reason=${input.reason} to=${maskPhoneNumber(input.destination)} sid=${result.sid ?? "unknown"}`,
  );
}

async function sendTestLaneSms(input: {
  destination: string;
  body: string;
  reason: SmsReason;
}): Promise<void> {
  assertTestLaneConfig(input.destination);

  const { url, apiKey, label } = config.sms.testLane;
  const response = await fetch(url!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "sms",
      label,
      reason: input.reason,
      to: input.destination,
      body: input.body,
      sent_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`SMS test lane delivery failed (${response.status}): ${details}`);
  }

  console.info(
    `[migraauth] sms sent provider=test-lane reason=${input.reason} to=${maskPhoneNumber(input.destination)}`,
  );
}

async function sendSmsMessage(input: {
  destination: string;
  body: string;
  reason: SmsReason;
}): Promise<void> {
  assertSmsEnabledOutsideDevelopment();

  if (config.smsProvider === "console") {
    console.info(
      `[migraauth] sms sent provider=console reason=${input.reason} to=${maskPhoneNumber(input.destination)}`,
    );
    if (config.sms.console.logBody) {
      console.info(`[migraauth] dev sms body: ${input.body}`);
    }
    return;
  }

  if (config.smsProvider === "twilio") {
    await sendTwilioSms(input);
    return;
  }

  if (config.smsProvider === "test-lane") {
    await sendTestLaneSms(input);
    return;
  }

  throw new Error(`Unsupported SMS provider: ${config.smsProvider}`);
}

export async function sendVerificationCode(input: {
  channel: "EMAIL" | "SMS";
  destination: string;
  code: string;
}): Promise<void> {
  if (input.channel === "EMAIL") {
    await sendVerificationEmail(input.destination, input.code);
    return;
  }

  await sendSmsMessage({
    destination: input.destination,
    body: `Your MigraTeck verification code is ${input.code}. It expires in 10 minutes.`,
    reason: "signup_verification",
  });
}

export async function sendPasswordResetNotification(input: {
  channel: "EMAIL" | "SMS";
  destination: string;
  tokenOrCode: string;
  clientId?: string;
}): Promise<void> {
  if (input.channel === "EMAIL") {
    await sendPasswordResetEmail(input.destination, input.tokenOrCode, input.clientId);
    return;
  }

  await sendSmsMessage({
    destination: input.destination,
    body: `Your MigraTeck password reset code is ${input.tokenOrCode}. It expires in 30 minutes.`,
    reason: "password_reset",
  });
}
