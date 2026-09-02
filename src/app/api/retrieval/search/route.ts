import { NextResponse } from "next/server";
import { DEFAULT_USER_ID } from "@/server/config";
import { grepSearch } from "@/server/retrieval/grep-tool";
import type { GrepSearchInput } from "@/shared/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GrepSearchInput;
    if (!body.queries?.length) {
      return NextResponse.json({ ok: false, error: "queries is required" }, { status: 400 });
    }

    const result = await grepSearch({
      ...body,
      userId: body.userId ?? DEFAULT_USER_ID,
      corpus: body.corpus ?? "classified",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown retrieval error" },
      { status: 500 },
    );
  }
}
