import { NextResponse } from "next/server";

import { listIncidents } from "@/lib/ops/incidents-store";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const env = url.searchParams.get("env");
	const status = url.searchParams.get("status");
	const limit = Number(url.searchParams.get("limit") ?? "100");

	return NextResponse.json({
		ok: true,
		data: {
			incidents: listIncidents({ env, status, limit })
		}
	});
}
