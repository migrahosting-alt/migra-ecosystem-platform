import { authorizeMhApiRequest, mhApiJson, rebuildMhApiServer } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string }> };

type RebuildRequestBody = {
  imageSlug?: string;
  hostname?: string;
  sshKeys?: string[];
  reason?: string;
};

export async function POST(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => ({}))) as RebuildRequestBody;
  const { serverId } = await params;
  const result = await rebuildMhApiServer(serverId, body);
  if (!result) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(result);
}