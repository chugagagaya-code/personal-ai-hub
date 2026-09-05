import type { Project } from "@/shared/types";
import { getDatabase } from "@/server/database/database";

export function saveProjectOverride(projectId: string, patch: { name?: string; description?: string }): void {
  const current = getDatabase().prepare("SELECT name, description FROM project_overrides WHERE project_id = ?").get(projectId) as { name?: string; description?: string } | undefined;
  getDatabase().prepare(`INSERT INTO project_overrides(project_id, name, description, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET name=excluded.name, description=excluded.description, updated_at=excluded.updated_at`)
    .run(projectId, patch.name?.trim() || current?.name || null, patch.description?.trim() || current?.description || null, new Date().toISOString());
}

export function applyProjectOverrides(projects: Project[]): Project[] {
  const rows = getDatabase().prepare("SELECT project_id, name, description FROM project_overrides").all() as Array<{ project_id: string; name?: string; description?: string }>;
  const byId = new Map(rows.map((row) => [row.project_id, row]));
  return projects.map((project) => {
    const override = byId.get(project.id);
    return override ? { ...project, name: override.name || project.name, description: override.description || project.description, updatedAt: new Date().toISOString() } : project;
  });
}

export function saveConversationAssignment(conversationId: string, projectId: string): void {
  getDatabase().prepare(`INSERT INTO conversation_assignments(conversation_id, project_id, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET project_id=excluded.project_id, updated_at=excluded.updated_at`)
    .run(conversationId, projectId, new Date().toISOString());
}

export function readConversationAssignments(): Map<string, string> {
  const rows = getDatabase().prepare("SELECT conversation_id, project_id FROM conversation_assignments").all() as Array<{ conversation_id: string; project_id: string }>;
  return new Map(rows.map((row) => [row.conversation_id, row.project_id]));
}
