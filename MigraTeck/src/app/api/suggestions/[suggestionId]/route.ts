import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { dismissSuggestion, acceptSuggestion } from "@/lib/suggestions";

type RouteContext = { params: Promise<{ suggestionId: string }> };

export async function PATCH(request: NextRequest, props: RouteContext) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const { suggestionId } = await props.params;
  const body = await request.json();
  const action = body.action as "dismiss" | "accept";

  if (action === "dismiss") {
    const result = await dismissSuggestion(suggestionId);
    return NextResponse.json(result);
  }

  if (action === "accept") {
    const result = await acceptSuggestion(suggestionId);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Invalid action. Use 'dismiss' or 'accept'." }, { status: 400 });
}
