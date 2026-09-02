import { NextResponse } from "next/server";
import { appendMemoryOverride, type MemoryMutationInput } from "@/server/memory/memory-overrides";

const ACTIONS = new Set(["update", "ignore", "supersede", "merge"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MemoryMutationInput;
    if (!ACTIONS.has(body.action)) {
      return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
    }
    if (!body.targetMemoryIds?.length) {
      return NextResponse.json({ ok: false, error: "targetMemoryIds is required" }, { status: 400 });
    }
    if ((body.action === "merge" || body.action === "supersede") && !body.replacement) {
      return NextResponse.json({ ok: false, error: "replacement is required" }, { status: 400 });
    }

    const result = await appendMemoryOverride(body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown memory mutation error" },
      { status: 500 },
    );
  }
}
