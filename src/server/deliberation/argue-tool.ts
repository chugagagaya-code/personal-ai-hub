import type { DeliberationResult, GrepMatch } from "@/shared/types";

export interface ResolveClaimConflictInput {
  question: string;
  evidence: GrepMatch[];
  maxRounds?: number;
}

export async function resolveClaimConflict(input: ResolveClaimConflictInput): Promise<DeliberationResult> {
  const maxRounds = Math.max(1, Math.min(input.maxRounds ?? 3, 5));

  return {
    status: "best_supported",
    rounds: 0,
    summary:
      `检测到潜在冲突，但当前还没有接入双 LLM 模型网关。已按最多 ${maxRounds} 轮的工具契约保留入口，暂时返回证据优先的 best_supported 状态。`,
    unresolvedClaims: extractUnresolvedClaims(input.evidence),
  };
}

function extractUnresolvedClaims(evidence: GrepMatch[]): string[] {
  return evidence.slice(0, 5).map((match) => `${match.file}:${match.line} ${match.text.slice(0, 180)}`);
}
