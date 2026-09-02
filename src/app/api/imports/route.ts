import { NextResponse } from "next/server";
import { importLocalRawData } from "@/server/ingestion/import-service";

export async function POST() {
  try {
    const result = await importLocalRawData();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown import error" },
      { status: 500 },
    );
  }
}
