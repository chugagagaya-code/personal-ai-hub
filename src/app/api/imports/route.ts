import { NextResponse } from "next/server";
import { enqueueJob } from "@/server/jobs/job-queue";

export async function POST() {
  try {
    const result = enqueueJob("import");
    return NextResponse.json({ ok: true, result }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown import error" },
      { status: 500 },
    );
  }
}
