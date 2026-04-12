import { HttpClient } from "./http";

export async function createTier2Intent(client: HttpClient, input: { action: string; orgId?: string; payload: unknown; reason?: string }) {
  const response = await client.post<{ intentId?: string; expiresAt?: string }>('/api/security/intents', {
    json: {
      action: input.action,
      orgId: input.orgId,
      payload: input.payload,
      reason: input.reason || "integration-test",
    },
  });

  if (response.status !== 201 || !response.body?.intentId) {
    throw new Error(`Unable to create intent for ${input.action} (status=${response.status})`);
  }

  return response.body.intentId;
}
