import { authorizeMhApiRequest, createMhApiConsoleSession, mhApiJson } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string }> };

type ConsoleRequestBody = {
  actorUserId?: string;
  viewOnly?: boolean;
};

export async function POST(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => ({}))) as ConsoleRequestBody;
  const { serverId } = await params;
  const result = await createMhApiConsoleSession(serverId, body);
  if (!result) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(result);
}