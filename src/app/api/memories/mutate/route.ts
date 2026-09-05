import { NextResponse } from "next/server";
import { appendMemoryOverride, type MemoryMutationInput } from "@/server/memory/memory-overrides";
import { recordAudit } from "@/server/database/audit";

const ACTIONS = new Set(["create", "update", "ignore", "supersede", "merge"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MemoryMutationInput;
    if (!ACTIONS.has(body.action)) {
      return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
    }
    if (body.action !== "create" && !body.targetMemoryIds?.length) {
      return NextResponse.json({ ok: false, error: "targetMemoryIds is required" }, { status: 400 });
    }
    if ((body.action === "create" || body.action === "merge" || body.action === "supersede") && !body.replacement) {
      return NextResponse.json({ ok: false, error: "replacement is required" }, { status: 400 });
    }

    const result = await appendMemoryOverride(body);
    recordAudit(`memory.${body.action}`, "memory", body.targetMemoryIds?.[0], { targetMemoryIds: body.targetMemoryIds, reason: body.reason });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown memory mutation error" },
      { status: 500 },
    );
  }
}
