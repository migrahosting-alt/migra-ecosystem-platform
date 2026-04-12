import { authorizeMhApiRequest, getMhApiHealth, mhApiJson } from "@/lib/vps/mh-api";

export async function GET(request: Request) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  return mhApiJson(await getMhApiHealth());
}