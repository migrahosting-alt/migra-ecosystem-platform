import { authorizeMhApiRequest, createMhApiSnapshot, listMhApiSnapshots, mhApiJson } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ serverId: string }> };

type SnapshotRequestBody = {
  name?: string;
};

export async function GET(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { serverId } = await params;
  const snapshots = await listMhApiSnapshots(serverId);
  if (!snapshots) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson({ snapshots });
}

export async function POST(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => ({}))) as SnapshotRequestBody;
  if (!body.name?.trim()) {
    return mhApiJson({ error: "Snapshot name is required." }, 400);
  }

  const { serverId } = await params;
  const result = await createMhApiSnapshot(serverId, body.name.trim());
  if (!result) {
    return mhApiJson({ error: "Server not found." }, 404);
  }

  return mhApiJson(result);
}