process.env.AUTONOMY_SMOKE_MODE = "1";

async function run(): Promise<void> {
  const enrollRoute = await import("../app/api/autonomy/hids-edr/enroll/route");
  const ingestRoute = await import("../app/api/autonomy/hids-edr/route");
  const heartbeatRoute = await import("../app/api/autonomy/hids-edr/heartbeat/route");
  const configRoute = await import("../app/api/autonomy/config/route");
  const findingsRoute = await import("../app/api/autonomy/findings/route");
  const runOnceRoute = await import("../app/api/autonomy/runOnce/route");
  const actionRoute = await import("../app/api/autonomy/hids-edr/actions/route");
  const approveRoute = await import("../app/api/autonomy/hids-edr/actions/[actionId]/approve/route");

  const marker = `smoke_intrusion_${Date.now()}`;

  await configRoute.POST(
    new Request("http://localhost/api/autonomy/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: {
          enabled: true,
          runnerPolicy: { allowServer: false, defaultRunnerTarget: "local" },
          environmentPolicy: { defaultEnv: "dev", prodAllowed: false },
          budgets: {
            missionsPerHour: 6,
            tier2PerDay: 1,
            maxWritesPerMission: 3,
            maxFailuresPerHour: 5,
            maxAffectedTenantsPerMission: 2
          },
          confidenceGate: {
            minConfidenceToContinue: 0.5,
            decayOnFailure: 0.15,
            decayOnRetry: 0.05
          }
        }
      })
    })
  );

  const enrollmentResponse = await enrollRoute.POST(
    new Request("http://localhost/api/autonomy/hids-edr/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "smoke-win-agent",
        host: "SMOKE-HOST",
        os: "windows"
      })
    })
  );

  const enrollment = (await enrollmentResponse.json()) as {
    ok: boolean;
    data?: { agentId: string; token: string };
  };
  if (!enrollment.ok || !enrollment.data?.agentId || !enrollment.data.token) {
    throw new Error("enrollment failed");
  }

  const authHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${enrollment.data.token}`
  };

  const heartbeatResponse = await heartbeatRoute.POST(
    new Request("http://localhost/api/autonomy/hids-edr/heartbeat", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        agentId: enrollment.data.agentId,
        nonce: `hb_${Date.now()}`,
        timestampMs: Date.now(),
        status: "healthy"
      })
    })
  );
  const heartbeat = (await heartbeatResponse.json()) as { ok: boolean };
  if (!heartbeat.ok) {
    throw new Error("heartbeat failed");
  }

  const ingestResponse = await ingestRoute.POST(
    new Request("http://localhost/api/autonomy/hids-edr", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        agentId: enrollment.data.agentId,
        nonce: `ing_${Date.now()}`,
        timestampMs: Date.now(),
        event: {
          eventId: `evt_${marker}`,
          ts: new Date().toISOString(),
          host: "SMOKE-HOST",
          severity: "critical",
          indicator: marker,
          details: "simulated brute-force and persistence chain",
          classification: "internal"
        }
      })
    })
  );

  const ingest = (await ingestResponse.json()) as {
    ok: boolean;
    data?: { accepted: number };
  };
  if (!ingest.ok || (ingest.data?.accepted ?? 0) < 1) {
    throw new Error("ingest failed");
  }

  await runOnceRoute.POST(
    new Request("http://localhost/api/autonomy/runOnce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    })
  );

  const findingsResponse = await findingsRoute.GET(new Request("http://localhost/api/autonomy/findings?limit=100"));
  const findingsPayload = (await findingsResponse.json()) as {
    ok: boolean;
    data?: {
      findings: Array<{
        findingId: string;
        source: string;
        title: string;
      }>;
    };
  };

  const finding = findingsPayload.data?.findings.find((item) => item.source === "hids_edr" && item.title.includes(marker));
  if (!finding) {
    throw new Error("hids finding not found");
  }

  const requestActionResponse = await actionRoute.POST(
    new Request("http://localhost/api/autonomy/hids-edr/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "request",
        agentId: enrollment.data.agentId,
        findingId: finding.findingId,
        action: "isolate-host",
        objective: "Contain simulated intrusion during smoke"
      })
    })
  );

  const requestedAction = (await requestActionResponse.json()) as {
    ok: boolean;
    data?: { action: { actionId: string } };
  };
  const actionId = requestedAction.data?.action.actionId;
  if (!requestedAction.ok || !actionId) {
    throw new Error("action request failed");
  }

  const approveResponse = await approveRoute.POST(
    new Request(`http://localhost/api/autonomy/hids-edr/actions/${actionId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedBy: "smoke-operator" })
    }),
    { params: Promise.resolve({ actionId }) }
  );
  const approved = (await approveResponse.json()) as { ok: boolean };
  if (!approved.ok) {
    throw new Error("action approve failed");
  }

  const listApprovedResponse = await actionRoute.GET(
    new Request(`http://localhost/api/autonomy/hids-edr/actions?agentId=${enrollment.data.agentId}&status=approved`, {
      headers: { authorization: `Bearer ${enrollment.data.token}` }
    })
  );

  const approvedList = (await listApprovedResponse.json()) as {
    ok: boolean;
    data?: { actions: Array<{ actionId: string }> };
  };
  const approvedAction = approvedList.data?.actions.find((item) => item.actionId === actionId);
  if (!approvedAction) {
    throw new Error("approved action not listed");
  }

  const ackResponse = await actionRoute.POST(
    new Request("http://localhost/api/autonomy/hids-edr/actions", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        mode: "ack",
        actionId,
        executionNotes: "smoke ack from test harness"
      })
    })
  );
  const ackPayload = (await ackResponse.json()) as { ok: boolean };
  if (!ackPayload.ok) {
    throw new Error("action ack failed");
  }

  console.log("HIDS/EDR E2E smoke passed");
  console.log(JSON.stringify({
    agentId: enrollment.data.agentId,
    findingId: finding.findingId,
    actionId
  }, null, 2));
}

run().catch((error) => {
  console.error("HIDS/EDR E2E smoke failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
