import { NextResponse } from "next/server";
import { listAuditEvents } from "@/server/database/audit";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
  return NextResponse.json({ ok: true, result: listAuditEvents(limit) });
}
