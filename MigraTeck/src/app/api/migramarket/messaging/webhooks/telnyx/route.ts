import { NextRequest, NextResponse } from "next/server";
import { processTelnyxWebhookPayload, recordTelnyxWebhookEvent, verifyTelnyxWebhookSignature } from "@/lib/migramarket-messaging";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("telnyx-signature-ed25519");
  const timestamp = request.headers.get("telnyx-timestamp");

  if (!verifyTelnyxWebhookSignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as unknown;
  try {
    await recordTelnyxWebhookEvent(rawBody, payload);
    await processTelnyxWebhookPayload(payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed." },
      { status: 400 },
    );
  }
}
