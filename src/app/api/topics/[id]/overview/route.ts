import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PROJECTS_DIR } from "@/server/config";
import { listMemories } from "@/server/memory/memory-store";
import { readJsonl } from "@/server/utils/jsonl";
import type { SemanticUnit, TopicOverview, TopicProfile } from "@/shared/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^topic-[a-f0-9]{10}$/.test(id)) {
      return NextResponse.json({ ok: false, error: "invalid topic id" }, { status: 400 });
    }

    const projectDir = path.join(PROJECTS_DIR, id);
    const [profileBody, units, memories] = await Promise.all([
      fs.readFile(path.join(projectDir, "profile.json"), "utf8"),
      readJsonl<SemanticUnit>(path.join(projectDir, "semantic-units.jsonl")),
      listMemories({ projectIds: [id], includeInactive: false, limit: 100000 }),
    ]);
    const profile = JSON.parse(profileBody) as TopicProfile;
    const memoryTypeCounts = memories.reduce<TopicOverview["memoryTypeCounts"]>((counts, memory) => {
      counts[memory.type] = (counts[memory.type] ?? 0) + 1;
      return counts;
    }, {});
    const conversationMonths = new Map<string, string>();
    for (const unit of units) {
      if (!unit.occurredAt || conversationMonths.has(unit.conversationId)) continue;
      const date = new Date(unit.occurredAt);
      const month = Number.isNaN(date.getTime())
        ? unit.occurredAt.slice(0, 7)
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      conversationMonths.set(unit.conversationId, month);
    }
    const monthCounts = new Map<string, number>();
    for (const month of conversationMonths.values()) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    const result: TopicOverview = {
      profile,
      memoryTypeCounts,
      monthlyConversationCounts: [...monthCounts].sort(([left], [right]) => left.localeCompare(right)).map(([month, count]) => ({ month, count })),
    };

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "topic profile not found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown topic overview error" },
      { status: 500 },
    );
  }
}
