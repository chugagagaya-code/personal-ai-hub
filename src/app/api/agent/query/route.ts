import { NextResponse } from "next/server";
import { answerAgentQuery } from "@/server/agent/agent-service";
import type { AgentQueryInput } from "@/shared/types";
import { recordAudit } from "@/server/database/audit";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AgentQueryInput;
    if (!body.query?.trim()) {
      return NextResponse.json({ ok: false, error: "query is required" }, { status: 400 });
    }
    if (body.searchMode && body.searchMode !== "project" && body.searchMode !== "all") {
      return NextResponse.json({ ok: false, error: "invalid searchMode" }, { status: 400 });
    }

    const result = await answerAgentQuery(body);
    recordAudit("agent.queried", "query", undefined, { query: body.query, intent: result.intent?.kind, evidenceCount: result.evidence.length, generationMode: result.generation?.mode });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown agent query error" },
      { status: 500 },
    );
  }
}
