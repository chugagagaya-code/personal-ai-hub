import fs from "node:fs/promises";
import path from "node:path";
import type {
  MemoryRecord,
  NormalizedConversation,
  NormalizedMessage,
  Project,
  SemanticUnit,
} from "@/shared/types";
import { NORMALIZED_DIR, PROJECTS_DIR } from "@/server/config";
import { extractRuleMemories, unitToConversationMemory } from "@/server/memory/rule-extractor";
import { extractKeywords } from "@/server/projects/keyword";
import { clusterConversations } from "@/server/projects/topic-clusterer";
import { applyProjectOverrides, readConversationAssignments } from "@/server/projects/project-overrides";
import { stableId } from "@/server/utils/stable-id";
import { writeJsonl } from "@/server/utils/jsonl";

export async function buildCorpus(conversations: NormalizedConversation[], messages: NormalizedMessage[]) {
  await fs.mkdir(NORMALIZED_DIR, { recursive: true });
  await fs.rm(PROJECTS_DIR, { recursive: true, force: true });
  await fs.mkdir(PROJECTS_DIR, { recursive: true });

  await writeJsonl(path.join(NORMALIZED_DIR, "conversations.jsonl"), conversations);
  await writeJsonl(path.join(NORMALIZED_DIR, "messages.jsonl"), messages);

  const messagesByConversation = groupBy(messages, (message) => message.conversationId);
  const clusteredTopics = clusterConversations(conversations, messagesByConversation);
  const overriddenProjects = new Map(applyProjectOverrides(clusteredTopics.map((topic) => topic.project)).map((project) => [project.id, project]));
  const topics = clusteredTopics.map((topic) => ({ ...topic, project: overriddenProjects.get(topic.project.id) ?? topic.project }));
  const manualAssignments = readConversationAssignments();
  const topicById = new Map(topics.map((topic) => [topic.project.id, topic]));
  const topicByConversation = new Map(
    topics.flatMap((topic) => topic.conversations.map((conversation) => [conversation.id, topic] as const)),
  );
  for (const [conversationId, projectId] of manualAssignments) {
    const target = topicById.get(projectId);
    if (target) topicByConversation.set(conversationId, target);
  }
  const projectMap = new Map<string, Project>();
  const unitsByProject = new Map<string, SemanticUnit[]>();
  const memoriesByProject = new Map<string, MemoryRecord[]>();
  const conversationIdsByProject = new Map<string, Set<string>>();

  for (const conversation of conversations) {
    const conversationMessages = messagesByConversation.get(conversation.id) ?? [];
    const project = topicByConversation.get(conversation.id)?.project;
    if (!project) continue;
    projectMap.set(project.id, project);
    const assignedIds = conversationIdsByProject.get(project.id) ?? new Set<string>();
    assignedIds.add(conversation.id);
    conversationIdsByProject.set(project.id, assignedIds);

    const units = buildSemanticUnits(project.id, conversation, conversationMessages);
    unitsByProject.set(project.id, [...(unitsByProject.get(project.id) ?? []), ...units]);

    const memories = units.flatMap((unit) => [unitToConversationMemory(unit), ...extractRuleMemories(unit)]);
    memoriesByProject.set(project.id, [...(memoriesByProject.get(project.id) ?? []), ...memories]);
  }

  for (const project of projectMap.values()) {
    const projectDir = path.join(PROJECTS_DIR, project.id);
    const units = unitsByProject.get(project.id) ?? [];
    const memories = memoriesByProject.get(project.id) ?? [];

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "project.json"), JSON.stringify(project, null, 2), "utf8");
    const profile = topics.find((topic) => topic.project.id === project.id)?.profile;
    if (profile) {
      const assignedIds = conversationIdsByProject.get(project.id) ?? new Set<string>();
      const adjustedProfile = {
        ...profile,
        description: profile.description.replace(/^共 \d+ 段对话/, `共 ${assignedIds.size} 段对话`),
        conversationCount: assignedIds.size,
        representativeConversations: profile.representativeConversations.filter((item) => assignedIds.has(item.conversationId)),
        recentConversations: profile.recentConversations.filter((item) => assignedIds.has(item.conversationId)),
      };
      await fs.writeFile(path.join(projectDir, "profile.json"), JSON.stringify(adjustedProfile, null, 2), "utf8");
    }
    await writeJsonl(path.join(projectDir, "semantic-units.jsonl"), units);
    await writeJsonl(path.join(projectDir, "memories.jsonl"), memories);
    await fs.writeFile(path.join(projectDir, "knowledge.md"), renderKnowledgeMarkdown(project, memories), "utf8");
  }

  await writeJsonl(path.join(PROJECTS_DIR, "project-index.jsonl"), [...projectMap.values()]);

  return {
    conversationCount: conversations.length,
    messageCount: messages.length,
    projectCount: projectMap.size,
    projects: [...projectMap.values()],
  };
}

function buildSemanticUnits(
  projectId: string,
  conversation: NormalizedConversation,
  messages: NormalizedMessage[],
): SemanticUnit[] {
  const units: SemanticUnit[] = [];

  for (let index = 0; index < messages.length; index += 2) {
    const pair = messages.slice(index, index + 2);
    const content = pair.map((message) => `${message.role}: ${message.content}`).join("\n\n");
    if (!content.trim()) continue;

    units.push({
      id: stableId(["unit", conversation.id, index]),
      projectId,
      conversationId: conversation.id,
      messageIds: pair.map((message) => message.id),
      platform: conversation.platform,
      title: conversation.title,
      content,
      keywords: extractKeywords(`${conversation.title}\n${content}`),
      sourceRoutes: pair.map((message) => message.source),
      occurredAt: inferUnitDate(pair, conversation),
    });
  }

  return units;
}

function inferUnitDate(messages: NormalizedMessage[], conversation: NormalizedConversation): string | undefined {
  return messages.find((message) => message.createdAt)?.createdAt ?? conversation.insertedAt ?? conversation.updatedAt;
}

function renderKnowledgeMarkdown(project: Project, memories: MemoryRecord[]): string {
  const sections = memories.map((memory) => {
    const routeSummary = memory.sourceRoutes
      .map((route) => `${route.platform}:${route.conversationId ?? ""}:${route.messageId ?? ""}`)
      .join(", ");

    return [
      `## ${memory.subject}`,
      "",
      `- memory_id: ${memory.id}`,
      `- type: ${memory.type}`,
      `- status: ${memory.status}`,
      `- extraction_method: ${memory.extractionMethod}`,
      `- confidence: ${memory.confidence}`,
      memory.occurredAt ? `- occurred_at: ${memory.occurredAt}` : undefined,
      memory.derivedFromSemanticUnitId ? `- derived_from: ${memory.derivedFromSemanticUnitId}` : undefined,
      `- keywords: ${memory.keywords.join(", ")}`,
      `- source_routes: ${routeSummary}`,
      "",
      memory.content,
      "",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  });

  return [`# ${project.name}`, "", ...sections].join("\n");
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    result.set(key, [...(result.get(key) ?? []), item]);
  }
  return result;
}
