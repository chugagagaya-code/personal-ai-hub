import { getDatabase } from "@/server/database/database";

export interface AuditEvent {
  id: number;
  action: string;
  entityType: string;
  entityId?: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export function recordAudit(action: string, entityType: string, entityId?: string, details: Record<string, unknown> = {}): void {
  getDatabase().prepare("INSERT INTO audit_events(action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(action, entityType, entityId ?? null, JSON.stringify(details), new Date().toISOString());
}

export function listAuditEvents(limit = 100): AuditEvent[] {
  const rows = getDatabase().prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 500)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id), action: String(row.action), entityType: String(row.entity_type),
    entityId: row.entity_id ? String(row.entity_id) : undefined,
    details: JSON.parse(String(row.details_json)) as Record<string, unknown>, createdAt: String(row.created_at),
  }));
}
