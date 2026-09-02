import fs from "node:fs/promises";
import path from "node:path";
import { RAW_DATA_DIR } from "@/server/config";
import { buildCorpus } from "@/server/corpus/corpus-builder";
import { parseDeepSeekJsonFile } from "@/server/ingestion/deepseek";
import { parseGeminiTextFile } from "@/server/ingestion/gemini";
import type { NormalizedConversation, NormalizedMessage } from "@/shared/types";

const SUPPORTED_EXTENSIONS = new Set([".json", ".md", ".txt"]);

export async function importLocalRawData() {
  const sourceFiles = await listSourceFiles(RAW_DATA_DIR);
  if (sourceFiles.length === 0) {
    throw new Error(`数据源目录中没有 .json、.md 或 .txt 文件：${RAW_DATA_DIR}`);
  }

  const parsed = await Promise.all(
    sourceFiles.map((filePath) =>
      path.extname(filePath).toLowerCase() === ".json"
        ? parseDeepSeekJsonFile(filePath)
        : parseGeminiTextFile(filePath).then(({ conversation, messages }) => ({
            conversations: [conversation],
            messages,
          })),
    ),
  );

  const conversations: NormalizedConversation[] = [];
  const messages: NormalizedMessage[] = [];
  for (const item of parsed) {
    conversations.push(...item.conversations);
    messages.push(...item.messages);
  }

  if (conversations.length === 0) {
    throw new Error("找到了数据文件，但没有识别出可导入的对话结构。");
  }

  return buildCorpus(conversations, messages);
}

async function listSourceFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(entryPath);
      if (
        entry.isFile() &&
        entry.name.toLowerCase() !== "readme.md" &&
        SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        return [entryPath];
      }
      return [];
    }),
  );

  return nested.flat().sort();
}
