import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PROJECTS_DIR } from "@/server/config";
import type { Project } from "@/shared/types";
import { saveProjectOverride } from "@/server/projects/project-overrides";
import { recordAudit } from "@/server/database/audit";
import { writeJsonl } from "@/server/utils/jsonl";

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

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { projectId?: string; name?: string; description?: string };
    if (!body.projectId || (!body.name?.trim() && !body.description?.trim())) {
      return NextResponse.json({ ok: false, error: "projectId 以及 name/description 至少一项必填" }, { status: 400 });
    }
    const indexPath = path.join(PROJECTS_DIR, "project-index.jsonl");
    const projects = (await fs.readFile(indexPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Project);
    const index = projects.findIndex((project) => project.id === body.projectId);
    if (index < 0) return NextResponse.json({ ok: false, error: "主题不存在" }, { status: 404 });
    saveProjectOverride(body.projectId, { name: body.name, description: body.description });
    projects[index] = { ...projects[index], ...(body.name?.trim() ? { name: body.name.trim() } : {}), ...(body.description?.trim() ? { description: body.description.trim() } : {}), updatedAt: new Date().toISOString() };
    await writeJsonl(indexPath, projects);
    await fs.writeFile(path.join(PROJECTS_DIR, body.projectId, "project.json"), JSON.stringify(projects[index], null, 2), "utf8");
    recordAudit("project.updated", "project", body.projectId, { name: body.name, descriptionChanged: Boolean(body.description) });
    return NextResponse.json({ ok: true, result: projects[index] });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "主题更新失败" }, { status: 500 });
  }
}
