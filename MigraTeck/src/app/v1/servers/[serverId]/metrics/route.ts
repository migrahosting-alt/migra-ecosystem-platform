import { authorizeMhApiRequest, getMhApiMetrics, mhApiJson } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string }> };

export async function GET(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { serverId } = await params;
  const range = new URL(request.url).searchParams.get("range") || "24h";
  const metrics = await getMhApiMetrics(serverId, range);
  if (!metrics) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(metrics);
}