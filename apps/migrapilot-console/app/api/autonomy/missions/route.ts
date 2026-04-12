import { NextResponse } from "next/server";

import { PILOT_API_BASE, OPS_TOKEN } from "@/lib/shared/pilot-api-config";

function buildHeaders(incoming: Headers): Record<string, string> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (OPS_TOKEN) {
		headers["x-ops-api-token"] = OPS_TOKEN;
	}
	const cookie = incoming.get("cookie");
	if (cookie) headers.cookie = cookie;
	const auth = incoming.get("authorization");
	if (auth) headers.authorization = auth;
	return headers;
}

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const upstream = await fetch(`${PILOT_API_BASE}/api/autonomy/missions${url.search}`, {
			method: "GET",
			headers: buildHeaders(request.headers),
			cache: "no-store",
		});

		if (upstream.ok) {
			const payload = await upstream.json().catch(() => null);
			if (payload && typeof payload === "object") {
				return NextResponse.json(payload, { status: upstream.status });
			}
		}

		if (upstream.status !== 404) {
			const payload = await upstream.json().catch(() => ({ ok: false, error: "upstream returned non-JSON" }));
			return NextResponse.json(payload, { status: upstream.status });
		}
	} catch {
		// Fall through to local empty registry.
	}

	return NextResponse.json({ ok: true, data: { missions: [] } });
}
