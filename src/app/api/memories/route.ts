import { NextResponse } from "next/server";
import { listMemories } from "@/server/memory/memory-store";
import type { MemoryRecord, MemoryType } from "@/shared/types";

const MEMORY_TYPES: MemoryType[] = ["event", "task", "problem", "decision", "knowledge", "conversation"];

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "unassigned";
    const scope = url.searchParams.get("scope");
    const type = url.searchParams.get("type") as MemoryType | null;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const includeInactive = url.searchParams.get("includeInactive") === "true";

    if (type && !MEMORY_TYPES.includes(type)) {
      return NextResponse.json({ ok: false, error: "invalid memory type" }, { status: 400 });
    }

    const memories = await listMemories({
      projectIds: scope === "all" ? undefined : [projectId],
      types: type ? [type] : undefined,
      limit,
      includeInactive,
    });

    return NextResponse.json({ ok: true, result: memories });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: true, result: [] });
    }

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown memories error" },
      { status: 500 },
    );
  }
}
