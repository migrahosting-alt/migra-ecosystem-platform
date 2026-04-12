const baseUrl = process.env.MIGRAPILOT_BRAIN_URL ?? 'http://127.0.0.1:7777';

async function main() {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      toolName: 'repo.search',
      runnerTarget: 'local',
      environment: 'dev',
      operator: { operatorId: 'smoke-user', role: 'owner' },
      toolInput: {
        query: 'Mission',
        maxResults: 3
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.ok || !payload.data?.result?.ok) {
    throw new Error(`Smoke failed: ${JSON.stringify(payload)}`);
  }

  console.log('Brain execute smoke passed');
  console.log(`runner=${payload.data.overlay?.runnerUsed ?? 'unknown'}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
