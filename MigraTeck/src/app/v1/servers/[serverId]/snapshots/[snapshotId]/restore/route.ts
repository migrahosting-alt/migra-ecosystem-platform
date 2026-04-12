import { authorizeMhApiRequest, mhApiJson, restoreMhApiSnapshot } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string; snapshotId: string }> };

export async function POST(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { serverId, snapshotId } = await params;
  const result = await restoreMhApiSnapshot(serverId, snapshotId);
  if (result === null) {
    return mhApiJson({ error: "Server not found." }, 404);
  }
  if (result === undefined) {
    return mhApiJson({ error: "Snapshot not found." }, 404);
  }

  return mhApiJson(result);
}