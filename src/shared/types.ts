export type Platform = "deepseek" | "gemini";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type MemoryType = "event" | "task" | "problem" | "decision" | "knowledge" | "conversation";

export type MemoryStatus = "active" | "superseded" | "merged" | "ignored";
export type MemoryOverrideAction = "update" | "ignore" | "supersede" | "merge";

export type CorpusScope = "classified" | "raw" | "all";

export type AnswerStatus = "verified" | "consensus" | "best_supported" | "disputed" | "insufficient";

export interface SourceRoute {
  platform: Platform;
  sourceFile: string;
  conversationId?: string;
  messageId?: string;
  jsonPath?: string;
  lineStart?: number;
  lineEnd?: number;
  url?: string;
}

export interface SourceLookupResult {
  route: SourceRoute;
  title?: string;
  role?: MessageRole;
  model?: string;
  createdAt?: string;
  content: string;
  nearbyMessages?: Array<{
    role: MessageRole;
    model?: string;
    createdAt?: string;
    content: string;
    messageId?: string;
  }>;
}

export interface NormalizedConversation {
  id: string;
  platform: Platform;
  title: string;
  sourceFile: string;
  insertedAt?: string;
  updatedAt?: string;
  url?: string;
}

export interface NormalizedMessage {
  id: string;
  conversationId: string;
  platform: Platform;
  role: MessageRole;
  model?: string;
  content: string;
  createdAt?: string;
  source: SourceRoute;
}

export interface SemanticUnit {
  id: string;
  projectId: string;
  conversationId: string;
  messageIds: string[];
  platform: Platform;
  title: string;
  content: string;
  keywords: string[];
  sourceRoutes: SourceRoute[];
  occurredAt?: string;
}

export interface Project {
  id: string;
  name: string;
  aliases: string[];
  description?: string;
  priority?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRule {
  id: string;
  name: string;
  aliases: string[];
  description?: string;
  keywords: string[];
  patterns?: string[];
  priority?: number;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  type: MemoryType;
  status: MemoryStatus;
  subject: string;
  content: string;
  keywords: string[];
  sourceRoutes: SourceRoute[];
  derivedFromSemanticUnitId?: string;
  extractionMethod: "conversation_unit" | "rule" | "manual";
  confidence: number;
  occurredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryOverride {
  id: string;
  action: MemoryOverrideAction;
  targetMemoryIds: string[];
  replacementMemory?: MemoryRecord;
  patch?: Partial<Pick<MemoryRecord, "projectId" | "type" | "status" | "subject" | "content" | "keywords">>;
  reason?: string;
  createdAt: string;
}

export interface GrepSearchInput {
  userId: string;
  projectIds?: string[];
  corpus: CorpusScope;
  queries: string[];
  contextLines?: number;
  maxResults?: number;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
  query: string;
  score: number;
  parsed?: {
    subject?: string;
      content?: string;
      type?: MemoryType;
      status?: MemoryStatus;
      id?: string;
      projectId?: string;
      sourceRoutes?: SourceRoute[];
      occurredAt?: string;
    };
}

export interface AgentQueryInput {
  userId?: string;
  query: string;
  projectIds?: string[];
  searchMode?: "project" | "all";
  followupContext?: {
    projectIds?: string[];
    memoryIds?: string[];
    sourceRoutes?: SourceRoute[];
    keywords?: string[];
  };
}

export interface AgentAnswer {
  status: AnswerStatus;
  answer: string;
  evidence: GrepMatch[];
  usedFallbackRawSearch: boolean;
  deliberation?: DeliberationResult;
  nextActions: string[];
}

export interface DeliberationResult {
  status: AnswerStatus;
  rounds: number;
  summary: string;
  unresolvedClaims: string[];
}
