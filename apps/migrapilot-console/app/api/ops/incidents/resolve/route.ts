import { NextResponse } from "next/server";

import { resolveIncident } from "@/lib/ops/incidents-store";

export async function POST(request: Request) {
	const body = await request.json().catch(() => null) as { id?: unknown } | null;
	if (!body || typeof body.id !== "string" || !body.id.trim()) {
		return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
	}

	const incident = resolveIncident(body.id);
	if (!incident) {
		return NextResponse.json({ ok: false, error: "incident not found" }, { status: 404 });
	}

	return NextResponse.json({ ok: true, data: { incident } });
}
