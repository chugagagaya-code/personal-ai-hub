import { extractKeywords } from "@/server/projects/keyword";

const QUERY_STOP_WORDS = [
  "我的",
  "我想",
  "关于",
  "有关",
  "这个",
  "那个",
  "一下",
  "请问",
  "帮我",
  "事业",
  "计划",
  "情况",
  "内容",
  "答案",
  "怎么",
  "如何",
  "什么",
];

export function planGrepQueries(userQuery: string, followupKeywords: string[] = []): string[] {
  const quoted = [...userQuery.matchAll(/[“"']([^“"']{2,})[”"']/g)].map((match) => match[1]);
  const compactQuestion = normalizeQuestion(userQuery).slice(0, 120);
  const keywords = extractKeywords(compactQuestion, 8);
  const chineseTerms = extractChineseQueryTerms(compactQuestion);

  return [
    ...new Set([...quoted, ...chineseTerms, ...keywords, compactQuestion, ...followupKeywords].filter((query) => query.length >= 2)),
  ].slice(0, 16);
}

function normalizeQuestion(userQuery: string): string {
  return QUERY_STOP_WORDS.reduce((text, word) => text.replaceAll(word, " "), userQuery)
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractChineseQueryTerms(text: string): string[] {
  const terms = new Set<string>();
  const chunks = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];

  for (const chunk of chunks) {
    terms.add(chunk);
    for (let size = Math.min(6, chunk.length); size >= 2; size -= 1) {
      for (let index = 0; index <= chunk.length - size; index += 1) {
        const term = chunk.slice(index, index + size);
        if (!QUERY_STOP_WORDS.includes(term)) terms.add(term);
      }
    }
  }

  return [...terms].sort((a, b) => b.length - a.length).slice(0, 10);
}
