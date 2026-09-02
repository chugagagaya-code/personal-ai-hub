import type { GrepMatch } from "@/shared/types";

export function isEvidenceSufficient(matches: GrepMatch[]): boolean {
  if (matches.length >= 5) return true;
  const files = new Set(matches.map((match) => match.file));
  return matches.length >= 2 && files.size >= 2;
}

export function detectPotentialConflict(matches: GrepMatch[]): boolean {
  const joined = matches.map((match) => match.text).join("\n").toLowerCase();
  const positive = /(是|可以|支持|正确|true|yes|should)/i.test(joined);
  const negative = /(不是|不可以|不支持|错误|false|no|should not)/i.test(joined);
  return positive && negative;
}
