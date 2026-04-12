import type { MissionAnalysis, MissionRecord } from "../mission/types";

interface StartMissionPayload {
  goal: string;
  context?: {
    notes?: string;
  };
  runnerPolicy: {
    default: "auto" | "local" | "server";
    allowServer: boolean;
  };
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  operator: {
    operatorId: string;
    role: string;
    claims?: Record<string, unknown>;
  };
  origin?: {
    source: "manual" | "autonomy";
    findingId?: string;
    templateId?: string;
  };
  proposeBeforeExecute?: boolean;
  proposalWindowSecs?: number;
  analysis?: MissionAnalysis;
}

interface StartMissionResponse {
  ok: boolean;
  data?: {
    missionId: string;
  };
  error?: {
    message?: string;
  };
}

interface StepMissionResponse {
  ok: boolean;
  error?: {
    message?: string;
  };
}

interface MissionDetailResponse {
  ok: boolean;
  data?: MissionRecord;
  error?: {
    message?: string;
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function invokeStartRoute(payload: StartMissionPayload): Promise<Response> {
  if (process.env.MIGRAPILOT_BRAIN_BASE_URL) {
    return fetch(`${process.env.MIGRAPILOT_BRAIN_BASE_URL.replace(/\/$/, "")}/api/mission/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  const { POST } = await import("../../app/api/mission/start/route");
  return POST(
    new Request("http://localhost/api/mission/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

async function invokeStepRoute(payload: { missionId: string; maxTasks: number }): Promise<Response> {
  if (process.env.MIGRAPILOT_BRAIN_BASE_URL) {
    return fetch(`${process.env.MIGRAPILOT_BRAIN_BASE_URL.replace(/\/$/, "")}/api/mission/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  const { POST } = await import("../../app/api/mission/step/route");
  return POST(
    new Request("http://localhost/api/mission/step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

async function invokeMissionGetRoute(missionId: string): Promise<Response> {
  if (process.env.MIGRAPILOT_BRAIN_BASE_URL) {
    return fetch(`${process.env.MIGRAPILOT_BRAIN_BASE_URL.replace(/\/$/, "")}/api/mission/${missionId}`, {
      method: "GET"
    });
  }

  const { GET } = await import("../../app/api/mission/[missionId]/route");
  return GET(new Request(`http://localhost/api/mission/${missionId}`), {
    params: Promise.resolve({ missionId })
  });
}

export async function startMissionViaApi(payload: StartMissionPayload): Promise<MissionRecord> {
  const startResponse = await invokeStartRoute(payload);
  const started = await parseJson<StartMissionResponse>(startResponse);
  if (!started.ok || !started.data?.missionId) {
    throw new Error(started.error?.message ?? "Mission start failed");
  }
  return getMissionViaApi(started.data.missionId);
}

export async function stepMissionViaApi(input: { missionId: string; maxTasks: number }): Promise<MissionRecord> {
  const response = await invokeStepRoute(input);
  const stepped = await parseJson<StepMissionResponse>(response);
  if (!stepped.ok) {
    throw new Error(stepped.error?.message ?? "Mission step failed");
  }
  return getMissionViaApi(input.missionId);
}

export async function getMissionViaApi(missionId: string): Promise<MissionRecord> {
  const response = await invokeMissionGetRoute(missionId);
  const payload = await parseJson<MissionDetailResponse>(response);
  if (!payload.ok || !payload.data) {
    throw new Error(payload.error?.message ?? `Mission ${missionId} not found`);
  }
  return payload.data;
}
