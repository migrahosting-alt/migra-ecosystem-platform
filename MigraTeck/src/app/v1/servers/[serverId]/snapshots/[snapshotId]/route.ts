import { authorizeMhApiRequest, deleteMhApiSnapshot, mhApiJson } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string; snapshotId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { serverId, snapshotId } = await params;
  const result = await deleteMhApiSnapshot(serverId, snapshotId);
  if (result === null) {
    return mhApiJson({ error: "Server not found." }, 404);
  }
  if (result === undefined) {
    return mhApiJson({ error: "Snapshot not found." }, 404);
  }

  return mhApiJson(result);
}