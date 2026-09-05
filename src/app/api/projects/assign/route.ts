import { NextResponse } from "next/server";
import { saveConversationAssignment } from "@/server/projects/project-overrides";
import { recordAudit } from "@/server/database/audit";
import { enqueueJob } from "@/server/jobs/job-queue";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { conversationId?: string; projectId?: string };
    if (!body.conversationId || !body.projectId) return NextResponse.json({ ok: false, error: "conversationId 和 projectId 必填" }, { status: 400 });
    saveConversationAssignment(body.conversationId, body.projectId);
    recordAudit("conversation.reassigned", "conversation", body.conversationId, { projectId: body.projectId });
    const job = enqueueJob("import", { reason: "conversation_reassigned" });
    return NextResponse.json({ ok: true, result: { job } }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "人工归类失败" }, { status: 500 });
  }
}
