import fs from "node:fs/promises";
import path from "node:path";
import type { NormalizedConversation, NormalizedMessage, SourceRoute } from "@/shared/types";
import { stableId } from "@/server/utils/stable-id";

export async function parseGeminiMarkdownDir(markdownDir: string): Promise<{
  conversations: NormalizedConversation[];
  messages: NormalizedMessage[];
}> {
  const markdownFiles = await listTextFiles(markdownDir);

  const conversations: NormalizedConversation[] = [];
  const messages: NormalizedMessage[] = [];

  for (const filePath of markdownFiles) {
    const parsed = await parseGeminiTextFile(filePath);
    conversations.push(parsed.conversation);
    messages.push(...parsed.messages);
  }

  return { conversations, messages };
}

export async function parseGeminiTextFile(filePath: string): Promise<{
  conversation: NormalizedConversation;
  messages: NormalizedMessage[];
}> {
  const body = await fs.readFile(filePath, "utf8");
  const lines = body.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || path.basename(filePath, ".md");
  const url = lines.find((line) => line.startsWith("> 对话 URL:"))?.replace("> 对话 URL:", "").trim();
  const exportedAt = lines.find((line) => line.startsWith("> 导出时间:"))?.replace("> 导出时间:", "").trim();
  const conversationId = stableId(["gemini", filePath, title, url]);

  const messages: NormalizedMessage[] = [];
  let currentRole: NormalizedMessage["role"] | undefined;
  let currentStart = 0;
  let buffer: string[] = [];

  const flush = (lineEnd: number) => {
    const content = buffer.join("\n").trim();
    if (!currentRole || !content) return;

    const source: SourceRoute = {
      platform: "gemini",
      sourceFile: filePath,
      conversationId,
      messageId: `${messages.length + 1}`,
      lineStart: currentStart,
      lineEnd,
      url,
    };

    messages.push({
      id: stableId(["gemini", filePath, currentRole, currentStart, content.slice(0, 80)]),
      conversationId,
      platform: "gemini",
      role: currentRole,
      content,
      createdAt: extractTimeHint(content) ?? exportedAt,
      source,
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const questionMarker = line.trim() === "**Q：**" || line.trim() === "**Q:**";
    const answerMarker = line.trim() === "**A：**" || line.trim() === "**A:**";

    if (questionMarker || answerMarker) {
      flush(index);
      currentRole = questionMarker ? "user" : "assistant";
      currentStart = index + 1;
      buffer = [];
      continue;
    }

    if (currentRole) buffer.push(line);
  }

  flush(lines.length);

  // A plain TXT file without Gemini Q/A markers is still useful as one raw
  // conversation unit. Treat it as user-authored source material.
  if (messages.length === 0 && body.trim()) {
    messages.push({
      id: stableId(["text", filePath, body.slice(0, 80)]),
      conversationId,
      platform: "gemini",
      role: "user",
      content: body.trim(),
      createdAt: exportedAt,
      source: {
        platform: "gemini",
        sourceFile: filePath,
        conversationId,
        messageId: "1",
        lineStart: 1,
        lineEnd: lines.length,
        url,
      },
    });
  }

  return {
    conversation: {
      id: conversationId,
      platform: "gemini",
      title,
      sourceFile: filePath,
      insertedAt: exportedAt,
      updatedAt: exportedAt,
      url,
    },
    messages: messages.map((message) => ({
      ...message,
      content: stripGeminiMetadata(message.content),
    })),
  };
}

async function listTextFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTextFiles(entryPath);
      if (entry.isFile() && entry.name.toLowerCase() !== "readme.md" && /\.(md|txt)$/i.test(entry.name)) return [entryPath];
      return [];
    }),
  );
  return files.flat();
}

function extractTimeHint(content: string): string | undefined {
  return content.match(/> 提问时间:\s*(.+)/)?.[1]?.trim();
}

function stripGeminiMetadata(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("> 提问时间:"))
    .join("\n")
    .trim();
}
