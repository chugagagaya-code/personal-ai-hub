import type { AgentAnswer, AgentQueryInput, GrepMatch } from "@/shared/types";
import { DEFAULT_USER_ID } from "@/server/config";
import { resolveClaimConflict } from "@/server/deliberation/argue-tool";
import { getInactiveMemoryIds, readMemoryOverrides } from "@/server/memory/memory-overrides";
import { listMemories, memoryToGrepMatch, searchMemoriesByText } from "@/server/memory/memory-store";
import { inferProjectIdsFromText } from "@/server/projects/project-router";
import { parseDateRangeQuery } from "@/server/retrieval/date-query";
import { grepSearch } from "@/server/retrieval/grep-tool";
import { planGrepQueries } from "@/server/retrieval/query-planner";
import { detectPotentialConflict, isEvidenceSufficient } from "@/server/retrieval/sufficiency-evaluator";

export async function answerAgentQuery(input: AgentQueryInput): Promise<AgentAnswer> {
  const userId = input.userId ?? DEFAULT_USER_ID;
  const inferredProjectIds = inferProjectIdsFromText(input.query);
  const projectIds = input.searchMode === "all"
    ? undefined
    : input.projectIds?.length
    ? input.projectIds
    : input.followupContext?.projectIds?.length
      ? input.followupContext.projectIds
      : inferredProjectIds.length
        ? inferredProjectIds
        : undefined;
  const queries = planGrepQueries(input.query, input.followupContext?.keywords);
  const dateRange = parseDateRangeQuery(input.query);

  if (dateRange) {
    const dateMemories = await listMemories({
      projectIds,
      start: dateRange.start,
      end: dateRange.end,
      types: ["conversation", "decision", "task", "problem", "knowledge"],
      limit: 240,
      sort: "asc",
    });
    const dateEvidence = diversifyDateEvidence(dateMemories.map((memory, index) => memoryToGrepMatch(memory, index)));

    if (dateEvidence.length > 0) {
      return {
        status: "best_supported",
        answer: buildDateRangeAnswer(dateRange.label, dateEvidence),
        evidence: dateEvidence.slice(0, 12),
        usedFallbackRawSearch: false,
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

  if (!isEvidenceSufficient(classifiedEvidence)) {
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

  const conflict = detectPotentialConflict(evidence);
  const deliberation = conflict ? await resolveClaimConflict({ question: input.query, evidence, maxRounds: 3 }) : undefined;
  const status = evidence.length === 0 ? "insufficient" : deliberation?.status ?? "best_supported";

  return {
    status,
    answer: buildExtractiveAnswer(input.query, evidence),
    evidence: evidence.slice(0, 12),
    usedFallbackRawSearch,
    deliberation,
    nextActions: buildNextActions(evidence.length, usedFallbackRawSearch, conflict),
  };
}

function buildDateRangeAnswer(label: string, evidence: GrepMatch[]): string {
  const snippets = evidence
    .slice(0, 8)
    .map((match, index) => {
      const date = formatDateForAnswer(match.parsed?.occurredAt);
      const type = match.parsed?.type ?? "memory";
      const subject = match.parsed?.subject ?? "Untitled memory";
      return `${index + 1}. ${date} [${type}] ${subject}\n${formatEvidenceSnippet(match)}`;
    })
    .join("\n\n");

  return `我在 ${label} 的本地记忆里找到了这些事情：\n\n${snippets}`;
}

function formatDateForAnswer(value: string | undefined): string {
  if (!value) return "未知日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function buildExtractiveAnswer(query: string, evidence: GrepMatch[]): string {
  if (evidence.length === 0) {
    return `没有在当前本地知识库中找到和“${query}”足够相关的证据。`;
  }

  const snippets = evidence
    .slice(0, 5)
    .map((match, index) => `${index + 1}. ${formatEvidenceSnippet(match)}`)
    .join("\n");

  return `基于本地知识库，先给出证据摘录式回答：\n${snippets}`;
}

function formatEvidenceSnippet(match: GrepMatch): string {
  if (match.parsed?.content) {
    const subject = match.parsed.subject ? `【${match.parsed.subject}】` : "";
    return `${subject}${match.parsed.content}`.slice(0, 520);
  }

  return match.text;
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
  const conversationFirst = matches.filter((match) => match.parsed?.type === "conversation");
  const structured = matches.filter((match) => match.parsed?.type !== "conversation");
  const seenSubjects = new Set<string>();
  const diversified: GrepMatch[] = [];

  for (const match of [...conversationFirst, ...structured]) {
    const day = formatDateForAnswer(match.parsed?.occurredAt);
    const subject = match.parsed?.subject ?? match.text.slice(0, 80);
    const key = `${day}:${subject.replace(/^(Knowledge|Task|Problem|Decision):\s*/, "")}`;
    if (seenSubjects.has(key)) continue;
    seenSubjects.add(key);
    diversified.push(match);
  }

  return diversified.sort((a, b) => {
    const left = new Date(a.parsed?.occurredAt ?? "").getTime();
    const right = new Date(b.parsed?.occurredAt ?? "").getTime();
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
  });
}

function buildNextActions(evidenceCount: number, usedRaw: boolean, conflict: boolean): string[] {
  const actions: string[] = [];
  if (evidenceCount === 0) actions.push("需要启用外部搜索或补充原始数据。");
  if (usedRaw) actions.push("分类知识库证据不足，已回退到原始标准化库。");
  if (conflict) actions.push("检测到潜在冲突，应在接入模型网关后调用双 LLM argue 工具。");
  return actions;
}
