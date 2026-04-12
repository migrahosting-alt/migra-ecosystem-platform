import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { planAssistantReply } from "../../../lib/server/chat-planner";
import { appendMessage, ensureConversation } from "../../../lib/server/store";
import { startMission } from "../../../lib/mission/service";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    conversationId?: string;
    message?: string;
  };

  if (!body.message || !body.message.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "message is required" }
      },
      { status: 400 }
    );
  }

  const conversation = ensureConversation(body.conversationId);
  const userMessage = {
    id: `msg_${randomUUID()}`,
    role: "user" as const,
    content: body.message.trim(),
    createdAt: new Date().toISOString()
  };

  appendMessage(conversation.id, userMessage);

  const planned = planAssistantReply(body.message.trim());
  appendMessage(conversation.id, planned.assistant);

  // If the planner detected a mission intent, create a proposed mission (user must confirm or it auto-executes)
  let proposedMission: { missionId: string } | undefined;
  if (planned.missionRequest) {
    try {
      const started = await startMission({
        goal: planned.missionRequest.goal,
        context: {},
        runnerPolicy: { default: "auto", allowServer: false },
        environment: "dev",
        operator: { operatorId: "console-chat", role: "ops" },
        origin: { source: "manual" },
        proposeBeforeExecute: true,
        proposalWindowSecs: 120,
        analysis: planned.missionRequest.analysis
      });
      proposedMission = { missionId: started.mission.missionId };
    } catch {
      // Non-fatal: mission creation failure doesn't break the chat response
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      conversationId: conversation.id,
      user: userMessage,
      assistant: planned.assistant,
      proposedToolCalls: planned.proposed,
      proposedMission
    }
  });
}
