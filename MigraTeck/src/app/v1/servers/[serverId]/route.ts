import { authorizeMhApiRequest, getMhApiServer, mhApiJson } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string }> };

export async function GET(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { serverId } = await params;
  const server = await getMhApiServer(serverId);
  if (!server) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(server);
}