import type { MemoryRecord, MemoryType, SemanticUnit } from "@/shared/types";
import { extractKeywords } from "@/server/projects/keyword";
import { stableId } from "@/server/utils/stable-id";

interface MemoryRule {
  type: Exclude<MemoryType, "event" | "conversation">;
  subjectPrefix: string;
  confidence: number;
  patterns: RegExp[];
}

const MEMORY_RULES: MemoryRule[] = [
  {
    type: "decision",
    subjectPrefix: "Decision",
    confidence: 0.82,
    patterns: [
      /用户(决定|选择|明确)|我们(决定|选择|明确)|最终(决定|选择|采用)|确定(使用|采用)|采用.+方案|不使用\s*embedding|不要\s*embedding|用\s*next\.?js/i,
    ],
  },
  {
    type: "task",
    subjectPrefix: "Task",
    confidence: 0.68,
    patterns: [/需要|计划|开始|实施|实现|新增|改造|接入|整理|帮我|请帮我|todo|待办/i],
  },
  {
    type: "problem",
    subjectPrefix: "Problem",
    confidence: 0.72,
    patterns: [/遇到.+问题|问题是|存在.+问题|报错|失败|卡住|不对|不能|无法|error|failed|exception|bug|冲突|找不到|不满意/i],
  },
  {
    type: "knowledge",
    subjectPrefix: "Knowledge",
    confidence: 0.64,
    patterns: [/方法|步骤|说明|原因|原理|结论|建议|注意|如何|怎么|是什么|可以通过|主要有/i],
  },
];

export function extractRuleMemories(unit: SemanticUnit): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const text = unit.content;
  const now = new Date().toISOString();

  for (const rule of MEMORY_RULES) {
    const matched = rule.patterns.some((pattern) => pattern.test(text));
    if (!matched) continue;

    const content = summarizeRuleMemoryContent(text, rule.type);
    if (!content) continue;

    records.push({
      id: stableId(["rule-memory", rule.type, unit.id, content.slice(0, 80)]),
      projectId: unit.projectId,
      type: rule.type,
      status: "active",
      subject: `${rule.subjectPrefix}: ${unit.title}`.slice(0, 140),
      content,
      keywords: extractKeywords(`${unit.title}\n${content}`),
      sourceRoutes: unit.sourceRoutes,
      derivedFromSemanticUnitId: unit.id,
      extractionMethod: "rule",
      confidence: rule.confidence,
      occurredAt: unit.occurredAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  return records;
}

export function unitToConversationMemory(unit: SemanticUnit): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: stableId(["memory", unit.id]),
    projectId: unit.projectId,
    type: "conversation",
    status: "active",
    subject: unit.title,
    content: unit.content,
    keywords: unit.keywords,
    sourceRoutes: unit.sourceRoutes,
    derivedFromSemanticUnitId: unit.id,
    extractionMethod: "conversation_unit",
    confidence: 1,
    occurredAt: unit.occurredAt,
    createdAt: now,
    updatedAt: now,
  };
}

function summarizeRuleMemoryContent(text: string, type: MemoryRule["type"]): string {
  const cleaned = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("assistant: 服务器繁忙"))
    .join("\n");

  const relevantLines = cleaned
    .split(/\r?\n/)
    .filter((line) => isRelevantLine(line, type))
    .slice(0, 6);

  const fallback = cleaned.slice(0, 900);
  return (relevantLines.length ? relevantLines.join("\n") : fallback).slice(0, 1200).trim();
}

function isRelevantLine(line: string, type: MemoryRule["type"]): boolean {
  const rule = MEMORY_RULES.find((candidate) => candidate.type === type);
  if (type === "decision" && !/user:|用户|我们|最终|确定|采用|不使用|不要|next\.?js/i.test(line)) return false;
  if (type === "problem" && !/遇到|问题是|存在|报错|失败|卡住|不对|不能|无法|error|failed|exception|bug|冲突|找不到|不满意/i.test(line)) {
    return false;
  }
  return Boolean(rule?.patterns.some((pattern) => pattern.test(line)));
}
