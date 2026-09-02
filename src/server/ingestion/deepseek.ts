import fs from "node:fs/promises";
import path from "node:path";
import type { NormalizedConversation, NormalizedMessage } from "@/shared/types";
import { stableId } from "@/server/utils/stable-id";

interface DeepSeekFragment {
  type?: string;
  content?: string;
}

interface DeepSeekNode {
  id: string;
  parent: string | null;
  children?: string[];
  message?: {
    model?: string;
    inserted_at?: string;
    fragments?: DeepSeekFragment[];
  } | null;
}

interface DeepSeekConversation {
  id: string;
  title?: string;
  inserted_at?: string;
  updated_at?: string;
  mapping?: Record<string, DeepSeekNode>;
}

export async function parseDeepSeekExport(exportDir: string): Promise<{
  conversations: NormalizedConversation[];
  messages: NormalizedMessage[];
}> {
  const conversationsPath = path.join(exportDir, "conversations.json");
  return parseDeepSeekJsonFile(conversationsPath);
}

export async function parseDeepSeekJsonFile(conversationsPath: string): Promise<{
  conversations: NormalizedConversation[];
  messages: NormalizedMessage[];
}> {
  const raw = await fs.readFile(conversationsPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const payload = Array.isArray(parsed)
    ? (parsed as DeepSeekConversation[])
    : ((parsed as { conversations?: DeepSeekConversation[] }).conversations ?? []);

  if (!payload.some((item) => item && typeof item === "object" && "mapping" in item)) {
    return { conversations: [], messages: [] };
  }

  const conversations: NormalizedConversation[] = [];
  const messages: NormalizedMessage[] = [];

  for (const conversation of payload) {
    conversations.push({
      id: conversation.id,
      platform: "deepseek",
      title: conversation.title?.trim() || "Untitled DeepSeek Conversation",
      sourceFile: conversationsPath,
      insertedAt: conversation.inserted_at,
      updatedAt: conversation.updated_at,
    });

    const nodes = Object.values(conversation.mapping ?? {}).sort((a, b) => {
      const left = a.message?.inserted_at ?? "";
      const right = b.message?.inserted_at ?? "";
      return left.localeCompare(right) || a.id.localeCompare(b.id);
    });

    for (const node of nodes) {
      if (!node.message?.fragments?.length) continue;

      const content = node.message.fragments
        .map((fragment) => fragment.content?.trim() ?? "")
        .filter(Boolean)
        .join("\n\n")
        .trim();

      if (!content) continue;

      messages.push({
        id: stableId(["deepseek", conversation.id, node.id]),
        conversationId: conversation.id,
        platform: "deepseek",
        role: inferDeepSeekRole(node.message.fragments),
        model: node.message.model,
        content,
        createdAt: node.message.inserted_at,
        source: {
          platform: "deepseek",
          sourceFile: conversationsPath,
          conversationId: conversation.id,
          messageId: node.id,
          jsonPath: `$.mapping.${node.id}.message.fragments`,
        },
      });
    }
  }

  return { conversations, messages };
}

function inferDeepSeekRole(fragments: DeepSeekFragment[]): NormalizedMessage["role"] {
  const type = fragments.find((fragment) => fragment.type)?.type?.toUpperCase();
  if (type === "REQUEST") return "user";
  if (type === "RESPONSE" || type === "THINK") return "assistant";
  if (type === "TOOL_SEARCH" || type === "TOOL_OPEN") return "tool";
  return "unknown";
}
