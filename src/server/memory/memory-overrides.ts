import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryOverride, MemoryRecord } from "@/shared/types";
import { MEMORY_OVERRIDES_PATH } from "@/server/config";
import { stableId } from "@/server/utils/stable-id";

export interface MemoryMutationInput {
  action: MemoryOverride["action"];
  targetMemoryIds: string[];
  patch?: MemoryOverride["patch"];
  replacement?: {
    projectId: string;
    type: MemoryRecord["type"];
    subject: string;
    content: string;
    keywords?: string[];
    sourceRoutes?: MemoryRecord["sourceRoutes"];
    occurredAt?: string;
  };
  reason?: string;
}

export async function appendMemoryOverride(input: MemoryMutationInput): Promise<MemoryOverride> {
  const now = new Date().toISOString();
  const override: MemoryOverride = {
    id: stableId(["memory-override", now, input.action, input.targetMemoryIds.join(","), input.replacement?.subject]),
    action: input.action,
    targetMemoryIds: input.targetMemoryIds,
    patch: input.patch,
    reason: input.reason,
    createdAt: now,
    replacementMemory: input.replacement
      ? {
          id: stableId(["manual-memory", now, input.replacement.projectId, input.replacement.subject]),
          projectId: input.replacement.projectId,
          type: input.replacement.type,
          status: "active",
          subject: input.replacement.subject,
          content: input.replacement.content,
          keywords: input.replacement.keywords ?? [],
          sourceRoutes: input.replacement.sourceRoutes ?? [],
          extractionMethod: "manual",
          confidence: 1,
          occurredAt: input.replacement.occurredAt,
          createdAt: now,
          updatedAt: now,
        }
      : undefined,
  };

  await fs.mkdir(path.dirname(MEMORY_OVERRIDES_PATH), { recursive: true });
  await fs.appendFile(MEMORY_OVERRIDES_PATH, `${JSON.stringify(override)}\n`, "utf8");
  return override;
}

export async function readMemoryOverrides(): Promise<MemoryOverride[]> {
  try {
    const body = await fs.readFile(MEMORY_OVERRIDES_PATH, "utf8");
    return body
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryOverride);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export function applyMemoryOverrides(records: MemoryRecord[], overrides: MemoryOverride[]): MemoryRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));

  for (const override of overrides) {
    if (override.action === "create") {
      if (override.replacementMemory) byId.set(override.replacementMemory.id, override.replacementMemory);
      continue;
    }
    if (override.action === "update") {
      for (const id of override.targetMemoryIds) {
        const current = byId.get(id);
        if (!current) continue;
        byId.set(id, {
          ...current,
          ...override.patch,
          updatedAt: override.createdAt,
        });
      }
      continue;
    }

    if (override.action === "ignore") {
      for (const id of override.targetMemoryIds) {
        const current = byId.get(id);
        if (current) byId.set(id, { ...current, status: "ignored", updatedAt: override.createdAt });
      }
      continue;
    }

    if (override.action === "supersede" || override.action === "merge") {
      const nextStatus = override.action === "supersede" ? "superseded" : "merged";
      for (const id of override.targetMemoryIds) {
        const current = byId.get(id);
        if (current) byId.set(id, { ...current, status: nextStatus, updatedAt: override.createdAt });
      }
      if (override.replacementMemory) byId.set(override.replacementMemory.id, override.replacementMemory);
    }
  }

  return [...byId.values()];
}

export function getInactiveMemoryIds(overrides: MemoryOverride[]): Set<string> {
  const inactive = new Set<string>();

  for (const override of overrides) {
    if (override.action === "ignore" || override.action === "merge" || override.action === "supersede") {
      for (const id of override.targetMemoryIds) inactive.add(id);
    }
  }

  return inactive;
}
