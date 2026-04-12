import { NextResponse } from "next/server";

import { getRuntimeEnvStates } from "@/lib/autonomy/env-state-store";

export async function GET() {
	return NextResponse.json({
		ok: true,
		data: {
			states: getRuntimeEnvStates()
		}
	});
}
