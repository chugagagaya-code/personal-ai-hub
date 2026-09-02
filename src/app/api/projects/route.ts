import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PROJECTS_DIR } from "@/server/config";
import type { Project } from "@/shared/types";

export async function GET() {
  try {
    const indexPath = path.join(PROJECTS_DIR, "project-index.jsonl");
    const body = await fs.readFile(indexPath, "utf8");
    const projects = body
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Project);

    return NextResponse.json({ ok: true, result: projects });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: true, result: [] });
    }

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown projects error" },
      { status: 500 },
    );
  }
}
