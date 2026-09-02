import { NextResponse } from "next/server";
import { lookupSource } from "@/server/sources/source-lookup";
import type { SourceRoute } from "@/shared/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { route?: SourceRoute };
    if (!body.route?.platform || !body.route.sourceFile) {
      return NextResponse.json({ ok: false, error: "route is required" }, { status: 400 });
    }

    const result = await lookupSource(body.route);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown source lookup error" },
      { status: 500 },
    );
  }
}
