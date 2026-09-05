import { spawn } from "node:child_process";
import path from "node:path";
import type { GrepMatch, GrepSearchInput, MemoryRecord } from "@/shared/types";
import { NORMALIZED_DIR, PROJECTS_DIR, USER_DATA_DIR } from "@/server/config";

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_QUERY_LENGTH = 160;

export async function grepSearch(input: GrepSearchInput): Promise<GrepMatch[]> {
  const roots = resolveSearchRoots(input);
  const queries = input.queries.map((query) => query.trim()).filter(Boolean).slice(0, 12);
  const allMatches: GrepMatch[] = [];

  for (const query of queries) {
    if (query.length > MAX_QUERY_LENGTH) continue;
    for (const root of roots) {
      const matches = await runRipgrep(query, root, input.contextLines ?? 0, input.maxResults ?? 40);
      allMatches.push(...matches.map((match) => ({
        ...match,
        query,
        sourceKind: input.corpus === "raw" ? "raw" as const : "classified" as const,
      })));
      if (allMatches.length >= (input.maxResults ?? 40)) return rankMatches(allMatches).slice(0, input.maxResults ?? 40);
    }
  }

  return rankMatches(allMatches).slice(0, input.maxResults ?? 40);
}

function resolveSearchRoots(input: GrepSearchInput): string[] {
  const roots: string[] = [];

  if (input.corpus === "classified" || input.corpus === "all") {
    if (input.projectIds?.length) {
      roots.push(...input.projectIds.map((projectId) => path.join(PROJECTS_DIR, projectId)));
    } else {
      roots.push(PROJECTS_DIR);
    }
  }

  if (input.corpus === "raw" || input.corpus === "all") roots.push(NORMALIZED_DIR);

  return roots.map(assertInsideUserDataDir);
}

function assertInsideUserDataDir(targetPath: string): string {
  const resolvedUserDir = path.resolve(USER_DATA_DIR);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedUserDir, resolvedTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Search path escapes user data directory: ${targetPath}`);
  }

  return resolvedTarget;
}

function runRipgrep(query: string, root: string, contextLines: number, maxResults: number): Promise<GrepMatch[]> {
  return new Promise((resolve, reject) => {
    const args = [
      "--json",
      "--smart-case",
      "--fixed-strings",
      "--glob",
      "*.jsonl",
      "--glob",
      "*.md",
      "--context",
      String(Math.max(0, Math.min(contextLines, 5))),
      query,
      root,
    ];

    const child = spawn("rg", args, { windowsHide: true });
    const matches: GrepMatch[] = [];
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";

      for (const line of lines) {
        const match = parseRgJsonLine(line, query);
        if (match) matches.push(match);
        if (matches.length >= maxResults) child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code && code !== 1 && matches.length === 0) {
        reject(new Error(stderr || `rg exited with code ${code}`));
        return;
      }
      resolve(matches);
    });
  });
}

function parseRgJsonLine(line: string, query: string): GrepMatch | undefined {
  if (!line.trim()) return undefined;
  const event = JSON.parse(line) as {
    type: string;
    data?: {
      path?: { text?: string };
      line_number?: number;
      lines?: { text?: string };
    };
  };

  if (event.type !== "match" || !event.data?.path?.text || !event.data.line_number || !event.data.lines?.text) {
    return undefined;
  }

  return {
    file: event.data.path.text,
    line: event.data.line_number,
    text: sanitizeLine(event.data.lines.text),
    query,
    score: scoreLine(event.data.path.text, event.data.lines.text, query),
    parsed: parseJsonlMemory(event.data.lines.text),
  };
}

function parseJsonlMemory(line: string): GrepMatch["parsed"] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;

  try {
    const record = JSON.parse(trimmed) as Partial<MemoryRecord>;
    if (!record.subject && !record.content) return undefined;

    return {
      subject: record.subject,
      content: record.content,
      type: record.type,
      status: record.status,
      id: record.id,
      projectId: record.projectId,
      sourceRoutes: record.sourceRoutes,
      occurredAt: record.occurredAt,
    };
  } catch {
    return undefined;
  }
}

function sanitizeLine(line: string): string {
  const sanitized = line.replace(/(api[_-]?key|token|password)["']?\s*[:=]\s*["'][^"']+/gi, "$1: [redacted]").trim();
  return sanitized.length > 700 ? `${sanitized.slice(0, 700)}...` : sanitized;
}

function scoreLine(file: string, line: string, query: string): number {
  const lowerLine = line.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let score = lowerLine.includes(lowerQuery) ? 10 : 1;
  if (file.endsWith("knowledge.md")) score += 4;
  if (file.endsWith("semantic-units.jsonl")) score += 2;
  if (line.includes('"extractionMethod":"rule"') || line.includes("- extraction_method: rule")) score += 3;
  if (line.includes('"confidence":1') || line.includes("- confidence: 1")) score += 2;
  if (line.includes('"status":"active"') || line.includes("- status: active")) score += 2;
  if (line.includes('"sourceRoutes"') || line.includes("source_routes")) score += 1;
  return score;
}

function rankMatches(matches: GrepMatch[]): GrepMatch[] {
  const seen = new Set<string>();
  return matches
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
    .filter((match) => {
      const key = `${match.file}:${match.line}:${match.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
