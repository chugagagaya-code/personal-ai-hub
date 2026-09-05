import type {
  NormalizedConversation,
  NormalizedMessage,
  Project,
  SourceRoute,
  TopicConversationSummary,
  TopicProfile,
  TopicTerm,
} from "@/shared/types";
import { stableId } from "@/server/utils/stable-id";

type Vector = Map<string, number>;

interface Document {
  conversation: NormalizedConversation;
  messages: NormalizedMessage[];
  terms: Set<string>;
  vector: Vector;
}

export interface TopicCluster {
  project: Project;
  profile: TopicProfile;
  conversations: NormalizedConversation[];
}

const CHINESE_STOP_TERMS = new Set([
  "一个", "我们", "你们", "他们", "这个", "那个", "什么", "怎么", "如何", "可以", "需要", "就是", "还是", "因为", "所以",
  "然后", "现在", "已经", "没有", "不是", "一下", "一些", "进行", "如果", "但是", "以及", "的话", "时候", "问题", "回答",
  "数据", "用户", "使用", "可能", "模型", "方法", "分析", "内容", "提供", "建议", "包括", "通过", "相关", "处理", "结果",
]);
const CHINESE_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });
const ENGLISH_STOP_TERMS = new Set(["the", "and", "for", "with", "this", "that", "from", "your", "you", "are", "not", "but", "can"]);

export function clusterConversations(
  conversations: NormalizedConversation[],
  messagesByConversation: Map<string, NormalizedMessage[]>,
): TopicCluster[] {
  if (conversations.length === 0) return [];

  const tokenSets = conversations.map((conversation) => {
    const messages = messagesByConversation.get(conversation.id) ?? [];
    return new Set(tokenize(`${conversation.title}\n${messages.map((message) => message.content).join("\n")}`));
  });
  const documentFrequency = countDocumentFrequency(tokenSets);
  const documents = conversations.map<Document>((conversation, index) => {
    const messages = messagesByConversation.get(conversation.id) ?? [];
    const titleTokens = tokenize(conversation.title);
    const bodyTokens = tokenize(messages.map((message) => message.content).join("\n"));
    return {
      conversation,
      messages,
      terms: tokenSets[index],
      vector: makeTfIdfVector([...titleTokens, ...titleTokens, ...titleTokens, ...bodyTokens], documentFrequency, conversations.length),
    };
  });

  const requestedCount = Number(process.env.PERSONAL_AI_TOPIC_COUNT);
  const clusterCount = Number.isInteger(requestedCount) && requestedCount > 0
    ? Math.min(requestedCount, conversations.length)
    : estimateClusterCount(conversations.length);
  const assignments = bisectingKMeans(documents.map((document) => document.vector), clusterCount);
  const groups = Array.from({ length: clusterCount }, (_, clusterIndex) =>
    documents.filter((_, documentIndex) => assignments[documentIndex] === clusterIndex),
  ).filter((group) => group.length > 0);

  return groups
    .map((group) => buildTopicCluster(group))
    .sort((left, right) => right.profile.conversationCount - left.profile.conversationCount || left.project.name.localeCompare(right.project.name));
}

function buildTopicCluster(documents: Document[]): TopicCluster {
  const centroid = normalize(averageVectors(documents.map((document) => document.vector)));
  const ranked = documents
    .map((document) => ({ document, similarity: cosineSimilarity(document.vector, centroid) }))
    .sort((left, right) => right.similarity - left.similarity || left.document.conversation.title.localeCompare(right.document.conversation.title));
  const topTerms = buildTopTerms(documents, centroid);
  const topicLabel = topTerms.slice(0, 3).map((item) => item.term).join(" · ") || "综合主题";
  const projectId = `topic-${stableId([topicLabel, ...ranked.slice(0, 3).map((item) => item.document.conversation.id).sort()]).slice(0, 10)}`;
  const representativeConversations = ranked.slice(0, 5).map(({ document, similarity }) =>
    summarizeConversation(document, similarity),
  );
  const recentConversations = [...documents]
    .sort((left, right) => (conversationDate(right.conversation) ?? "").localeCompare(conversationDate(left.conversation) ?? ""))
    .slice(0, 6)
    .map((document) => summarizeConversation(document, cosineSimilarity(document.vector, centroid)));
  const dates = documents.map((document) => conversationDate(document.conversation)).filter((date): date is string => Boolean(date)).sort();
  const dateSpan = { start: dates[0], end: dates.at(-1) };
  const description = describeTopic(documents.length, dateSpan, topTerms, representativeConversations);
  const now = new Date().toISOString();
  const project: Project = {
    id: projectId,
    name: topicLabel,
    aliases: topTerms.slice(0, 8).map((item) => item.term),
    description,
    priority: documents.length,
    createdAt: now,
    updatedAt: now,
  };

  return {
    project,
    profile: {
      projectId,
      description,
      conversationCount: documents.length,
      topTerms,
      representativeConversations,
      recentConversations,
      dateSpan,
    },
    conversations: documents.map((document) => document.conversation),
  };
}

function buildTopTerms(documents: Document[], centroid: Vector): TopicTerm[] {
  return [...centroid.entries()]
    .filter(([term]) => isDisplayTerm(term))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([term, weight]) => {
      const supportConversationCount = documents.filter((document) => document.terms.has(term)).length;
      return { term, supportConversationCount, supportRatio: supportConversationCount / documents.length, weight };
    });
}

function describeTopic(
  count: number,
  dateSpan: TopicProfile["dateSpan"],
  topTerms: TopicTerm[],
  representatives: TopicConversationSummary[],
): string {
  const span = dateSpan.start
    ? `${formatMonth(dateSpan.start)} 至 ${formatMonth(dateSpan.end ?? dateSpan.start)}`
    : "日期未知";
  const terms = topTerms.slice(0, 5).map((item) => item.term).join("、") || "暂无核心词";
  const titles = representatives.slice(0, 3).map((item) => `《${item.title}》`).join("、") || "暂无代表标题";
  return `共 ${count} 段对话，时间跨度 ${span}。核心词：${terms}。代表对话：${titles}。`;
}

function summarizeConversation(document: Document, similarity: number): TopicConversationSummary {
  const firstMessage = document.messages[0];
  const sourceRoute: SourceRoute = firstMessage?.source ?? {
    platform: document.conversation.platform,
    sourceFile: document.conversation.sourceFile,
    conversationId: document.conversation.id,
    url: document.conversation.url,
  };
  return {
    conversationId: document.conversation.id,
    title: document.conversation.title || "未命名对话",
    similarity: Number(similarity.toFixed(4)),
    occurredAt: conversationDate(document.conversation),
    sourceRoute,
  };
}

function estimateClusterCount(documentCount: number): number {
  if (documentCount <= 3) return 1;
  return Math.max(2, Math.min(12, Math.round(Math.sqrt(documentCount / 2))));
}

function bisectingKMeans(vectors: Vector[], clusterCount: number): number[] {
  const groups: number[][] = [vectors.map((_, index) => index)];
  while (groups.length < clusterCount) {
    const splitIndex = groups.reduce((best, group, index) => splitPriority(group, vectors) > splitPriority(groups[best], vectors) ? index : best, 0);
    const [left, right] = splitGroup(groups[splitIndex], vectors);
    if (right.length === 0) break;
    groups.splice(splitIndex, 1, left, right);
  }
  const assignments = vectors.map(() => 0);
  groups.forEach((group, clusterIndex) => group.forEach((documentIndex) => { assignments[documentIndex] = clusterIndex; }));
  return assignments;
}

function splitPriority(group: number[], vectors: Vector[]): number {
  if (group.length < 2) return -1;
  const centroid = normalize(averageVectors(group.map((index) => vectors[index])));
  const dispersion = group.reduce((sum, index) => sum + 1 - cosineSimilarity(vectors[index], centroid), 0) / group.length;
  return group.length * (0.5 + dispersion);
}

function splitGroup(group: number[], vectors: Vector[]): [number[], number[]] {
  const first = group.reduce((best, index) => vectorMagnitude(vectors[index]) > vectorMagnitude(vectors[best]) ? index : best, group[0]);
  const second = group.reduce((farthest, index) =>
    cosineSimilarity(vectors[index], vectors[first]) < cosineSimilarity(vectors[farthest], vectors[first]) ? index : farthest, group[0]);
  let centroids = [vectors[first], vectors[second]];
  let sides = group.map(() => 0);
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const next = group.map((index) => cosineSimilarity(vectors[index], centroids[1]) > cosineSimilarity(vectors[index], centroids[0]) ? 1 : 0);
    if (next.every((side, index) => side === sides[index]) && iteration > 0) break;
    sides = next;
    const leftVectors = group.filter((_, index) => sides[index] === 0).map((index) => vectors[index]);
    const rightVectors = group.filter((_, index) => sides[index] === 1).map((index) => vectors[index]);
    if (leftVectors.length === 0 || rightVectors.length === 0) {
      const half = Math.ceil(group.length / 2);
      return [group.slice(0, half), group.slice(half)];
    }
    centroids = [normalize(averageVectors(leftVectors)), normalize(averageVectors(rightVectors))];
  }
  const minimumSideSize = Math.max(1, Math.floor(group.length * 0.2));
  let left = group.filter((_, index) => sides[index] === 0);
  let right = group.filter((_, index) => sides[index] === 1);
  if (left.length < minimumSideSize) {
    const move = right
      .map((index) => ({ index, preference: cosineSimilarity(vectors[index], centroids[0]) - cosineSimilarity(vectors[index], centroids[1]) }))
      .sort((a, b) => b.preference - a.preference)
      .slice(0, minimumSideSize - left.length)
      .map((item) => item.index);
    const moved = new Set(move);
    left = [...left, ...move];
    right = right.filter((index) => !moved.has(index));
  } else if (right.length < minimumSideSize) {
    const move = left
      .map((index) => ({ index, preference: cosineSimilarity(vectors[index], centroids[1]) - cosineSimilarity(vectors[index], centroids[0]) }))
      .sort((a, b) => b.preference - a.preference)
      .slice(0, minimumSideSize - right.length)
      .map((item) => item.index);
    const moved = new Set(move);
    right = [...right, ...move];
    left = left.filter((index) => !moved.has(index));
  }
  return [left, right];
}

function makeTfIdfVector(tokens: string[], documentFrequency: Map<string, number>, documentCount: number): Vector {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  const vector = new Map<string, number>();
  for (const [term, count] of counts) {
    const idf = Math.log((documentCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
    vector.set(term, (1 + Math.log(count)) * idf);
  }
  return normalize(vector);
}

function countDocumentFrequency(documents: Set<string>[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const terms of documents) for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  return frequency;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cleaned = text.replace(/服务器繁忙[，,。.!！\s]*请稍后再试[。.!！]?/g, " ");
  for (const word of cleaned.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
    if (!ENGLISH_STOP_TERMS.has(word)) tokens.push(word);
  }
  for (const segment of CHINESE_SEGMENTER.segment(cleaned)) {
    const term = segment.segment.trim().toLowerCase();
    if (!segment.isWordLike || !/[\u4e00-\u9fa5]/.test(term) || term.length < 2 || CHINESE_STOP_TERMS.has(term)) continue;
    tokens.push(term);
  }
  return tokens;
}

function isDisplayTerm(term: string): boolean {
  return term.length >= 2 && !CHINESE_STOP_TERMS.has(term) && !/^user|assistant|system$/i.test(term);
}

function averageVectors(vectors: Vector[]): Vector {
  const result = new Map<string, number>();
  for (const vector of vectors) for (const [term, value] of vector) result.set(term, (result.get(term) ?? 0) + value / vectors.length);
  return result;
}

function normalize(vector: Vector): Vector {
  const magnitude = vectorMagnitude(vector);
  if (magnitude === 0) return vector;
  return new Map([...vector].map(([term, value]) => [term, value / magnitude]));
}

function vectorMagnitude(vector: Vector): number {
  return Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
}

function cosineSimilarity(left: Vector, right: Vector): number {
  let dot = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const [term, value] of small) dot += value * (large.get(term) ?? 0);
  return dot / (vectorMagnitude(left) * vectorMagnitude(right) || 1);
}

function conversationDate(conversation: NormalizedConversation): string | undefined {
  return conversation.insertedAt ?? conversation.updatedAt;
}

function formatMonth(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 7) : `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
}
