import { NextResponse } from "next/server";

import { appendHidsEdrEvents, getHidsEdrEventPath, normalizeHidsEdrEvent, readHidsEdrEvents } from "../../../../lib/autonomy/hids-edr-store";
import { filterDuplicateEventIds, registerNonce } from "../../../../lib/autonomy/hids-edr-ingest-guard";
import { verifyAgentToken } from "../../../../lib/autonomy/hids-edr-agent-store";

interface IngestRequestBody {
  agentId?: unknown;
  nonce?: unknown;
  timestampMs?: unknown;
  event?: unknown;
  events?: unknown[];
}

function asText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice(7).trim();
}

function parseEvents(body: IngestRequestBody): unknown[] {
  if (Array.isArray(body.events)) {
    return body.events;
  }
  if (body.event !== undefined) {
    return [body.event];
  }
  return [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;

  const events = await readHidsEdrEvents();
  return NextResponse.json({
    ok: true,
    data: {
      eventPath: getHidsEdrEventPath(),
      events: events.slice(-limit).reverse()
    }
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as IngestRequestBody;
  const agentId = asText(body.agentId);
  const nonce = asText(body.nonce);
  const timestampMs = Number(body.timestampMs);

  if (agentId) {
    const token = bearerToken(request);
    const agent = verifyAgentToken(agentId, token);
    if (!agent) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "AUTH_ERROR",
            message: "Invalid agent token"
          }
        },
        { status: 401 }
      );
    }

    if (!nonce || !Number.isFinite(timestampMs)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "nonce and timestampMs are required for authenticated ingest"
          }
        },
        { status: 400 }
      );
    }

    const nonceGate = registerNonce({ agentId, nonce, timestampMs });
    if (!nonceGate.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: nonceGate.code,
            message: nonceGate.message
          }
        },
        { status: 409 }
      );
    }
  }

  const rawEvents = parseEvents(body);

  if (rawEvents.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide event or events[] payload"
        }
      },
      { status: 400 }
    );
  }

  const normalized = rawEvents
    .map((event) => {
      const candidate = normalizeHidsEdrEvent(event);
      if (!candidate) {
        return null;
      }
      return {
        ...candidate,
        agentId: candidate.agentId ?? (agentId || undefined)
      };
    })
    .filter((event): event is NonNullable<ReturnType<typeof normalizeHidsEdrEvent>> => Boolean(event));

  if (normalized.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "No valid HIDS/EDR events found in payload"
        }
      },
      { status: 400 }
    );
  }

  const { acceptedEventIds, duplicateEventIds } = filterDuplicateEventIds(normalized.map((event) => event.eventId));
  const acceptedSet = new Set(acceptedEventIds);
  const acceptedEvents = normalized.filter((event) => acceptedSet.has(event.eventId));

  await appendHidsEdrEvents(acceptedEvents);

  return NextResponse.json({
    ok: true,
    data: {
      accepted: acceptedEvents.length,
      dropped: rawEvents.length - normalized.length,
      duplicates: duplicateEventIds.length,
      eventPath: getHidsEdrEventPath()
    }
  });
}
