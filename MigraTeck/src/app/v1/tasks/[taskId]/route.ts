import { authorizeMhApiRequest, getMhApiTaskStatus, mhApiJson } from "@/lib/vps/mh-api";

type Params = { params: Promise<{ taskId: string }> };

export async function GET(request: Request, { params }: Params) {
  const unauthorized = authorizeMhApiRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { taskId } = await params;
  const task = await getMhApiTaskStatus(taskId);
  if (!task) {
    return mhApiJson({ error: "Task not found." }, 404);
  }

  return mhApiJson(task);
}