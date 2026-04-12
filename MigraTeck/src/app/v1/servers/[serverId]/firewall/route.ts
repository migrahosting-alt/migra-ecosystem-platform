import { authorizeMhApiRequest, getMhApiFirewall, mhApiJson, updateMhApiFirewall } from "@/lib/vps/mh-api";
import type { CanonicalFirewallState } from "@/lib/vps/firewall/types";

type Params = { params: Promise<{ serverId: string }> };

export async function GET(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { serverId } = await params;
  const firewall = await getMhApiFirewall(serverId);
  if (!firewall) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(firewall);
}

export async function PUT(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => null)) as CanonicalFirewallState | null;
  if (!body) {
    return mhApiJson({ error: "Invalid firewall payload." }, 400);
  }

  const { serverId } = await params;
  const result = await updateMhApiFirewall(serverId, body);
  if (!result) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(result);
}