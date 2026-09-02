import projectRules from "./project-rules.json";
import type { NormalizedConversation, NormalizedMessage, Project, ProjectRule } from "@/shared/types";

const ROUTING_RULES = (projectRules as ProjectRule[])
  .map((rule) => ({
    ...rule,
    compiledPatterns: (rule.patterns ?? []).map((pattern) => new RegExp(pattern, "i")),
  }))
  .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

export function inferProjectIdsFromText(text: string): string[] {
  return ROUTING_RULES.filter((rule) => isRuleMatch(rule, text) && rule.id !== "unassigned").map((rule) => rule.id);
}

export function classifyConversationProject(
  conversation: NormalizedConversation,
  messages: NormalizedMessage[],
): Project {
  const title = conversation.title;

  for (const rule of ROUTING_RULES) {
    if (rule.id !== "unassigned" && isRuleMatch(rule, title)) {
      return makeProject(rule);
    }
  }

  const haystack = `${title}\n${messages.map((message) => message.content).join("\n").slice(0, 8000)}`;
  for (const rule of ROUTING_RULES) {
    if (rule.id !== "unassigned" && isRuleMatch(rule, haystack)) {
      return makeProject(rule);
    }
  }

  return makeProject(ROUTING_RULES.find((rule) => rule.id === "unassigned") ?? {
    id: "unassigned",
    name: "Unassigned",
    aliases: ["未分类"],
    keywords: [],
  });
}

export function makeProject(rule: ProjectRule): Project {
  const now = new Date().toISOString();
  return {
    id: rule.id,
    name: rule.name,
    aliases: [...new Set([rule.name, ...rule.aliases])],
    description: rule.description,
    priority: rule.priority,
    createdAt: now,
    updatedAt: now,
  };
}

function isRuleMatch(rule: ProjectRule & { compiledPatterns: RegExp[] }, text: string): boolean {
  if (rule.compiledPatterns.some((pattern) => pattern.test(text))) return true;
  const lowerText = text.toLowerCase();
  return rule.keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}
