import type { AgentAnswer, AgentQueryInput, GrepMatch, MemoryCandidate, MemoryType } from "@/shared/types";
import { stableId } from "@/server/utils/stable-id";
import { DEFAULT_USER_ID } from "@/server/config";
import { generateGroundedAnswer } from "@/server/agent/answer-generator";
import { recognizeQueryIntent } from "@/server/agent/query-intent";
import { resolveClaimConflict } from "@/server/deliberation/argue-tool";
import { getInactiveMemoryIds, readMemoryOverrides } from "@/server/memory/memory-overrides";
import { listMemories, memoryToGrepMatch, searchMemoriesByText } from "@/server/memory/memory-store";
import { grepSearch } from "@/server/retrieval/grep-tool";
import { planGrepQueries } from "@/server/retrieval/query-planner";
import { detectPotentialConflict, isEvidenceSufficient } from "@/server/retrieval/sufficiency-evaluator";
import { externalSearch } from "@/server/tools/external-search-tool";
import { recordAudit } from "@/server/database/audit";

export async function answerAgentQuery(input: AgentQueryInput): Promise<AgentAnswer> {
  const userId = input.userId ?? DEFAULT_USER_ID;
  const intent = recognizeQueryIntent(input);
  const projectIds = intent.scope === "all"
    ? undefined
    : input.projectIds?.length
    ? input.projectIds
    : input.followupContext?.projectIds?.length
      ? input.followupContext.projectIds
      : undefined;
  const queries = intent.keywords.length ? intent.keywords : planGrepQueries(input.query, input.followupContext?.keywords);
  const dateRange = intent.dateRange;

  if (dateRange) {
    const dateMemories = await listMemories({
      projectIds,
      start: new Date(dateRange.start),
      end: new Date(dateRange.end),
      types: ["conversation", "decision", "task", "problem", "knowledge"],
      limit: 100000,
      sort: "asc",
    });
    const dateEvidence = sampleDateEvidence(
      diversifyDateEvidence(dateMemories.map((memory, index) => memoryToGrepMatch(memory, index))),
      20,
    );

    if (dateEvidence.length > 0) {
      const generated = await generateGroundedAnswer({ question: input.query, evidence: dateEvidence, intent });
      return {
        status: "best_supported",
        answer: generated.answer,
        evidence: dateEvidence.slice(0, 20),
        usedFallbackRawSearch: false,
        intent,
        generation: generated.metadata,
        memoryCandidates: buildTurnMemoryCandidates(input.query, generated.answer, projectIds, dateEvidence),
        nextActions: [],
      };
    }
  }

  const inactiveMemoryIds = getInactiveMemoryIds(await readMemoryOverrides());
  const effectiveMemoryEvidence = await searchMemoriesByText({ projectIds, queries, limit: 20 });
  const classifiedEvidence = mergeEvidence([
    ...effectiveMemoryEvidence,
    ...filterInactiveEvidence(
      await grepSearch({
        userId,
        projectIds,
        corpus: "classified",
        queries,
        contextLines: 1,
        maxResults: 20,
      }),
      inactiveMemoryIds,
    ),
  ]);

  let evidence: GrepMatch[] = classifiedEvidence;
  let usedFallbackRawSearch = false;

  if (intent.requiresRawDetail || !isEvidenceSufficient(classifiedEvidence)) {
    const broaderClassifiedEvidence = projectIds
      ? filterInactiveEvidence(
          await grepSearch({
            userId,
            corpus: "classified",
            queries,
            contextLines: 1,
            maxResults: 20,
          }),
          inactiveMemoryIds,
        )
      : [];

    const rawEvidence = await grepSearch({
      userId,
      projectIds: broaderClassifiedEvidence.length > 0 ? undefined : projectIds,
      corpus: "raw",
      queries,
      contextLines: 1,
      maxResults: 20,
    });
    evidence = mergeEvidence([...classifiedEvidence, ...broaderClassifiedEvidence, ...rawEvidence]);
    usedFallbackRawSearch = rawEvidence.length > 0;
  }

  let externalSearchNote: string | undefined;
  if (intent.kind === "fact" && (intent.requiresExternalSearch || !isEvidenceSufficient(evidence))) {
    const external = await externalSearch({ query: input.query, maxResults: 6 });
    externalSearchNote = external.note;
    if (external.results.length > 0) {
      evidence = mergeEvidence([...evidence, ...external.results.map((result, index) => ({
        file: result.url,
        line: 1,
        text: `${result.title}\n${result.snippet}`,
        query: "外部搜索",
        score: 32 - index,
        sourceKind: "external" as const,
        parsed: { subject: result.title, content: result.snippet, occurredAt: result.publishedAt },
      }))]);
    }
    recordAudit("external_search.executed", "query", undefined, { status: external.status, resultCount: external.results.length });
  }

  const conflict = detectPotentialConflict(evidence);
  const deliberation = conflict ? await resolveClaimConflict({ question: input.query, evidence, maxRounds: 3 }) : undefined;
  const status = evidence.length === 0 ? "insufficient" : deliberation?.status ?? "best_supported";
  const generated = await generateGroundedAnswer({
    question: input.query,
    evidence,
    intent,
    deliberationSummary: deliberation?.summary,
  });

  return {
    status,
    answer: generated.answer,
    evidence: evidence.slice(0, 12),
    usedFallbackRawSearch,
    deliberation,
    intent,
    generation: generated.metadata,
    memoryCandidates: buildTurnMemoryCandidates(input.query, generated.answer, projectIds, evidence),
    nextActions: buildNextActions(evidence.length, usedFallbackRawSearch, conflict, intent.requiresExternalSearch, externalSearchNote),
  };
}

function buildTurnMemoryCandidates(question: string, answer: string, projectIds?: string[], evidence: GrepMatch[] = []): MemoryCandidate[] {
  const projectId = projectIds?.[0] ?? evidence.find((item) => item.parsed?.projectId)?.parsed?.projectId;
  if (!projectId) return [];
  const rules: Array<{ type: Exclude<MemoryType, "event" | "conversation">; pattern: RegExp }> = [
    { type: "decision", pattern: /决定|确定|就按|采用|选择|不要|改成|换成/ },
    { type: "task", pattern: /接下来|需要|开始|实施|实现|新增|添加|修改|改一下|做这个|帮我/ },
    { type: "problem", pattern: /为什么|没效果|打不开|不对|太简单|太傻|有问题|找不到|无法|失败/ },
  ];
  const matched = rules.find((rule) => rule.pattern.test(question));
  if (!matched) return [];
  const now = new Date().toISOString();
  const cleanQuestion = question.replace(/\s+/g, " ").trim();
  return [{
    id: stableId(["turn-memory-candidate", projectId, matched.type, cleanQuestion, now]),
    projectId,
    type: matched.type,
    subject: `本轮${matched.type === "decision" ? "决策" : matched.type === "task" ? "任务" : "问题"}：${cleanQuestion}`.slice(0, 140),
    content: `用户：${cleanQuestion}\n智能体处理结果：${answer.slice(0, 800)}`,
    confidence: 0.72,
    createdAt: now,
  }];
}

function formatDateForAnswer(value: string | undefined): string {
  if (!value) return "未知日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}


function mergeEvidence(matches: GrepMatch[]): GrepMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = match.parsed?.content
      ? `${match.parsed.projectId}:${match.parsed.subject}:${match.parsed.content.slice(0, 80)}`
      : `${match.file}:${match.line}:${match.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterInactiveEvidence(matches: GrepMatch[], inactiveMemoryIds: Set<string>): GrepMatch[] {
  if (inactiveMemoryIds.size === 0) return matches;
  return matches.filter((match) => !match.parsed?.id || !inactiveMemoryIds.has(match.parsed.id));
}

function diversifyDateEvidence(matches: GrepMatch[]): GrepMatch[] {
  const conversationFirst = matches.filter((match) => match.parsed?.type === "conversation" && isUsefulTimelineEvidence(match));
  const structured = matches.filter((match) => match.parsed?.type !== "conversation");
  const preferred = conversationFirst.length > 0 ? conversationFirst : structured;
  const bestBySubject = new Map<string, GrepMatch>();

  for (const match of preferred) {
    const day = formatDateForAnswer(match.parsed?.occurredAt);
    const subject = match.parsed?.subject ?? match.text.slice(0, 80);
    const key = `${day}:${subject.replace(/^(Knowledge|Task|Problem|Decision):\s*/, "")}`;
    const existing = bestBySubject.get(key);
    if (!existing || timelineEvidenceQuality(match) > timelineEvidenceQuality(existing)) bestBySubject.set(key, match);
  }

  return [...bestBySubject.values()].sort((a, b) => {
    const left = new Date(a.parsed?.occurredAt ?? "").getTime();
    const right = new Date(b.parsed?.occurredAt ?? "").getTime();
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  });
}

function isUsefulTimelineEvidence(match: GrepMatch): boolean {
  const subject = match.parsed?.subject ?? "";
  const content = match.parsed?.content ?? match.text;
  return !/消息不完整|无文本内容|服务器繁忙|待补全|你好$|测试$/.test(subject) && content.trim().length >= 12;
}

function timelineEvidenceQuality(match: GrepMatch): number {
  const content = match.parsed?.content ?? match.text;
  let score = Math.min(content.length, 800) / 100;
  if (/user:/i.test(content)) score += 5;
  if (/assistant:\s*(用户|嗯，用户|我们需要)/i.test(content)) score -= 4;
  if (/服务器繁忙|消息不完整|无文本内容/.test(content)) score -= 8;
  return score;
}

function sampleDateEvidence(matches: GrepMatch[], limit: number): GrepMatch[] {
  if (matches.length <= limit) return matches;
  const selected = new Map<string, GrepMatch>();
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * (matches.length - 1) / (limit - 1));
    const match = matches[sourceIndex];
    selected.set(`${match.file}:${match.line}:${match.parsed?.subject ?? match.text}`, match);
  }
  return [...selected.values()];
}

function buildNextActions(evidenceCount: number, usedRaw: boolean, conflict: boolean, requiresExternalSearch: boolean, externalSearchNote?: string): string[] {
  const actions: string[] = [];
  if (evidenceCount === 0) actions.push("需要启用外部搜索或补充原始数据。");
  if (usedRaw) actions.push("分类知识库证据不足，已回退到原始标准化库。");
  if (conflict) actions.push("检测到潜在冲突，应在接入模型网关后调用双 LLM argue 工具。");
  if (externalSearchNote) actions.push(externalSearchNote);
  return actions;
}
