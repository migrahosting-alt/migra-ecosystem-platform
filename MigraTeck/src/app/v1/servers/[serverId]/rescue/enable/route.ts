import { authorizeMhApiRequest, enableMhApiRescue, mhApiJson } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { serverId } = await params;
  const result = await enableMhApiRescue(serverId);
  if (!result) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(result);
}