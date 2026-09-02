import fs from "node:fs/promises";
import path from "node:path";
import type { MessageRole, SourceLookupResult, SourceRoute } from "@/shared/types";
import { RAW_DATA_DIR } from "@/server/config";

interface DeepSeekFragment {
  type?: string;
  content?: string;
}

interface DeepSeekNode {
  id: string;
  message?: {
    model?: string;
    inserted_at?: string;
    fragments?: DeepSeekFragment[];
  } | null;
}

interface DeepSeekConversation {
  id: string;
  title?: string;
  mapping?: Record<string, DeepSeekNode>;
}

export async function lookupSource(route: SourceRoute): Promise<SourceLookupResult> {
  assertInsideRawData(route.sourceFile);

  if (route.platform === "deepseek") return lookupDeepSeekSource(route);
  if (route.platform === "gemini") return lookupGeminiSource(route);

  throw new Error(`Unsupported source platform: ${route.platform}`);
}

async function lookupDeepSeekSource(route: SourceRoute): Promise<SourceLookupResult> {
  if (!route.conversationId || !route.messageId) {
    throw new Error("DeepSeek source route requires conversationId and messageId");
  }

  const raw = await fs.readFile(route.sourceFile, "utf8");
  const conversations = JSON.parse(raw) as DeepSeekConversation[];
  const conversation = conversations.find((item) => item.id === route.conversationId);
  if (!conversation) throw new Error(`DeepSeek conversation not found: ${route.conversationId}`);

  const nodes = Object.values(conversation.mapping ?? {}).sort((a, b) => {
    const left = a.message?.inserted_at ?? "";
    const right = b.message?.inserted_at ?? "";
    return left.localeCompare(right) || a.id.localeCompare(b.id);
  });
  const nodeIndex = nodes.findIndex((node) => node.id === route.messageId);
  if (nodeIndex === -1) throw new Error(`DeepSeek message not found: ${route.messageId}`);

  const node = nodes[nodeIndex];
  return {
    route,
    title: conversation.title,
    role: inferDeepSeekRole(node.message?.fragments ?? []),
    model: node.message?.model,
    createdAt: node.message?.inserted_at,
    content: joinFragments(node.message?.fragments ?? []),
    nearbyMessages: nodes.slice(Math.max(0, nodeIndex - 2), nodeIndex + 3).flatMap((nearby) => {
      if (!nearby.message?.fragments?.length) return [];
      return [
        {
          role: inferDeepSeekRole(nearby.message.fragments),
          model: nearby.message.model,
          createdAt: nearby.message.inserted_at,
          content: joinFragments(nearby.message.fragments),
          messageId: nearby.id,
        },
      ];
    }),
  };
}

async function lookupGeminiSource(route: SourceRoute): Promise<SourceLookupResult> {
  const raw = await fs.readFile(route.sourceFile, "utf8");
  const lines = raw.split(/\r?\n/);
  const start = Math.max(1, route.lineStart ?? 1);
  const end = Math.min(lines.length, route.lineEnd ?? start + 80);
  const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim();

  return {
    route,
    title,
    role: inferGeminiRole(lines.slice(Math.max(0, start - 4), end).join("\n")),
    content: lines.slice(start - 1, end).join("\n").trim(),
    nearbyMessages: [
      {
        role: inferGeminiRole(lines.slice(Math.max(0, start - 4), end).join("\n")),
        content: lines.slice(start - 1, end).join("\n").trim(),
        messageId: route.messageId,
      },
    ],
  };
}

function assertInsideRawData(sourceFile: string): void {
  const rawRoot = path.resolve(RAW_DATA_DIR);
  const target = path.resolve(sourceFile);
  const relative = path.relative(rawRoot, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Source file escapes raw data directory: ${sourceFile}`);
  }
}

function joinFragments(fragments: DeepSeekFragment[]): string {
  return fragments
    .map((fragment) => fragment.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function inferDeepSeekRole(fragments: DeepSeekFragment[]): MessageRole {
  const type = fragments.find((fragment) => fragment.type)?.type?.toUpperCase();
  if (type === "REQUEST") return "user";
  if (type === "RESPONSE" || type === "THINK") return "assistant";
  if (type === "TOOL_SEARCH" || type === "TOOL_OPEN") return "tool";
  return "unknown";
}

function inferGeminiRole(text: string): MessageRole {
  if (/\*\*Q[:：]\*\*/.test(text)) return "user";
  if (/\*\*A[:：]\*\*/.test(text)) return "assistant";
  return "unknown";
}
