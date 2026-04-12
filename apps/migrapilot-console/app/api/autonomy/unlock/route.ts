import { NextResponse } from "next/server";

import { unlockRuntimeEnv, type RuntimeEnvName } from "@/lib/autonomy/env-state-store";

function isRuntimeEnvName(value: unknown): value is RuntimeEnvName {
	return value === "dev" || value === "staging" || value === "prod";
}

export async function POST(request: Request) {
	const body = await request.json().catch(() => null) as { env?: unknown; reason?: unknown } | null;
	if (!body || !isRuntimeEnvName(body.env)) {
		return NextResponse.json(
			{ ok: false, error: "env is required" },
			{ status: 400 }
		);
	}

	const states = unlockRuntimeEnv(body.env, typeof body.reason === "string" ? body.reason : null);

	return NextResponse.json({
		ok: true,
		data: {
			queued: false,
			message: `${body.env} unlocked`,
			states,
			env: body.env,
			state: states[body.env]
		}
	});
}
