const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "you",
  "我",
  "你",
  "的",
  "了",
  "是",
  "吗",
  "一个",
  "什么",
]);

export function extractKeywords(text: string, limit = 12): string[] {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,}/g) ?? [];
  const counts = new Map<string, number>();

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();
    if (STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}
