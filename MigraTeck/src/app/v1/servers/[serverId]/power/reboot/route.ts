import { authorizeMhApiRequest, mhApiJson, rebootMhApiServer } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => ({}))) as { hard?: boolean };
  const { serverId } = await params;
  const result = await rebootMhApiServer(serverId, body.hard === true);
  if (!result) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(result);
}