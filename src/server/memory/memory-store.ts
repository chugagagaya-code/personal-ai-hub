import fs from "node:fs/promises";
import path from "node:path";
import type { GrepMatch, MemoryRecord } from "@/shared/types";
import { PROJECTS_DIR } from "@/server/config";
import { applyMemoryOverrides, readMemoryOverrides } from "@/server/memory/memory-overrides";

export interface MemoryListInput {
  projectIds?: string[];
  types?: MemoryRecord["type"][];
  start?: Date;
  end?: Date;
  limit?: number;
  sort?: "asc" | "desc";
  includeInactive?: boolean;
}

export async function listMemories(input: MemoryListInput = {}): Promise<MemoryRecord[]> {
  const projectIds = input.projectIds?.length ? input.projectIds : await listProjectIds();
  const records: MemoryRecord[] = [];

  for (const projectId of projectIds) {
    const filePath = path.join(PROJECTS_DIR, projectId, "memories.jsonl");
    const body = await readOptionalFile(filePath);
    if (!body) continue;

    for (const line of body.split(/\r?\n/).filter(Boolean)) {
      const memory = JSON.parse(line) as MemoryRecord;
      if (input.types?.length && !input.types.includes(memory.type)) continue;
      if (!isWithinRange(memory.occurredAt, input.start, input.end)) continue;
      records.push(memory);
    }
  }

  const overrides = await readMemoryOverrides();
  const applied = applyMemoryOverrides(records, overrides).filter((memory) => input.includeInactive || memory.status === "active");

  return applied.sort((a, b) => sortMemories(a, b, input.sort ?? "desc")).slice(0, input.limit ?? 80);
}

export interface MemoryTextSearchInput {
  projectIds?: string[];
  queries: string[];
  limit?: number;
}

export async function searchMemoriesByText(input: MemoryTextSearchInput): Promise<GrepMatch[]> {
  const normalizedQueries = input.queries.map(normalizeSearchText).filter(Boolean);
  if (normalizedQueries.length === 0) return [];

  const memories = await listMemories({
    projectIds: input.projectIds,
    includeInactive: false,
    limit: 2000,
  });

  const matches: GrepMatch[] = [];

  for (const memory of memories) {
    const haystack = normalizeSearchText([memory.subject, memory.content, memory.keywords.join(" ")].join(" "));
    const matchedQuery = normalizedQueries.find((query) => haystack.includes(query));
    if (!matchedQuery) continue;

    matches.push(memoryToGrepMatch(memory, matches.length, matchedQuery, 28));
    if (matches.length >= (input.limit ?? 20)) break;
  }

  return matches;
}

export function memoryToGrepMatch(memory: MemoryRecord, index: number, query = "date-filter", score = 20): GrepMatch {
  return {
    file: `memory:${memory.projectId}`,
    line: index + 1,
    text: memory.content,
    query,
    score,
    sourceKind: "memory",
    parsed: {
      subject: memory.subject,
      content: memory.content,
      type: memory.type,
      status: memory.status,
      id: memory.id,
      projectId: memory.projectId,
      sourceRoutes: memory.sourceRoutes,
      occurredAt: memory.occurredAt,
    },
  };
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

async function listProjectIds(): Promise<string[]> {
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function isWithinRange(value: string | undefined, start?: Date, end?: Date): boolean {
  if (!start && !end) return true;
  const time = getTime(value);
  if (!Number.isFinite(time)) return false;
  if (start && time < start.getTime()) return false;
  if (end && time >= end.getTime()) return false;
  return true;
}

function getTime(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sortMemories(a: MemoryRecord, b: MemoryRecord, sort: "asc" | "desc"): number {
  const delta = getTime(a.occurredAt) - getTime(b.occurredAt);
  return sort === "asc" ? delta : -delta;
}
