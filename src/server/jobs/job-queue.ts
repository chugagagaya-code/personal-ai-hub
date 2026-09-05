import { randomUUID } from "node:crypto";
import { getDatabase } from "@/server/database/database";
import { recordAudit } from "@/server/database/audit";
import { importLocalRawData } from "@/server/ingestion/import-service";

export type JobStatus = "pending" | "running" | "completed" | "failed";
export interface JobRecord { id: string; type: string; status: JobStatus; payload: Record<string, unknown>; result?: unknown; error?: string; createdAt: string; startedAt?: string; completedAt?: string }

let workerRunning = false;

export function enqueueJob(type: "import", payload: Record<string, unknown> = {}): JobRecord {
  const job: JobRecord = { id: randomUUID(), type, status: "pending", payload, createdAt: new Date().toISOString() };
  getDatabase().prepare("INSERT INTO jobs(id,type,status,payload_json,created_at) VALUES (?,?,?,?,?)")
    .run(job.id, job.type, job.status, JSON.stringify(payload), job.createdAt);
  recordAudit("job.enqueued", "job", job.id, { type });
  scheduleWorker();
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  const row = getDatabase().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapJob(row) : undefined;
}

export function listJobs(limit = 30): JobRecord[] {
  return (getDatabase().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 100)) as Array<Record<string, unknown>>).map(mapJob);
}

export function scheduleWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  setTimeout(() => void runWorker(), 0);
}

async function runWorker(): Promise<void> {
  try {
    while (true) {
      const row = getDatabase().prepare("SELECT id, type FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1").get() as { id: string; type: string } | undefined;
      if (!row) break;
      const startedAt = new Date().toISOString();
      getDatabase().prepare("UPDATE jobs SET status='running', started_at=? WHERE id=?").run(startedAt, row.id);
      try {
        const result = row.type === "import" ? await importLocalRawData() : (() => { throw new Error(`未知任务类型：${row.type}`); })();
        const completedAt = new Date().toISOString();
        getDatabase().prepare("UPDATE jobs SET status='completed', result_json=?, completed_at=? WHERE id=?").run(JSON.stringify(result), completedAt, row.id);
        recordAudit("job.completed", "job", row.id, { type: row.type });
      } catch (error) {
        const completedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : "任务失败";
        getDatabase().prepare("UPDATE jobs SET status='failed', error=?, completed_at=? WHERE id=?").run(message, completedAt, row.id);
        recordAudit("job.failed", "job", row.id, { type: row.type, error: message });
      }
    }
  } finally {
    workerRunning = false;
  }
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id), type: String(row.type), status: String(row.status) as JobStatus,
    payload: JSON.parse(String(row.payload_json)), result: row.result_json ? JSON.parse(String(row.result_json)) : undefined,
    error: row.error ? String(row.error) : undefined, createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : undefined, completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}
