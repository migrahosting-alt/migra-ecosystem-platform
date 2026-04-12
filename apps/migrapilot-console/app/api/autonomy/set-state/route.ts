import { NextResponse } from "next/server";

import { setRuntimeEnvState, type RuntimeEnvName, type RuntimeEnvState } from "@/lib/autonomy/env-state-store";

function isRuntimeEnvName(value: unknown): value is RuntimeEnvName {
	return value === "dev" || value === "staging" || value === "prod";
}

function isRuntimeEnvState(value: unknown): value is RuntimeEnvState {
	return value === "NORMAL" || value === "CAUTION" || value === "READ_ONLY";
}

export async function POST(request: Request) {
	const body = await request.json().catch(() => null) as { env?: unknown; state?: unknown; reason?: unknown } | null;
	if (!body || !isRuntimeEnvName(body.env) || !isRuntimeEnvState(body.state)) {
		return NextResponse.json(
			{ ok: false, error: "env and state are required" },
			{ status: 400 }
		);
	}

	const states = setRuntimeEnvState(
		body.env,
		body.state,
		typeof body.reason === "string" ? body.reason : null
	);

	return NextResponse.json({
		ok: true,
		data: {
			states,
			env: body.env,
			state: states[body.env]
		}
	});
}
