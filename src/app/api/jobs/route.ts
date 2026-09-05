import { NextResponse } from "next/server";
import { getJob, listJobs, scheduleWorker } from "@/server/jobs/job-queue";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  scheduleWorker();
  const result = id ? getJob(id) : listJobs();
  if (id && !result) return NextResponse.json({ ok: false, error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, result });
}
