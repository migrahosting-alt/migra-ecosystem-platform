import { authorizeMhApiRequest, listMhApiServers, mhApiJson } from "@/lib/vps/mh-api";

export async function GET(request: Request) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const servers = await listMhApiServers();
  return mhApiJson({ servers });
}