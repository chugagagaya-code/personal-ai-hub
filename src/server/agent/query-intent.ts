import type { AgentQueryInput, QueryIntent, QueryIntentKind } from "@/shared/types";
import { parseDateRangeQuery } from "@/server/retrieval/date-query";
import { planGrepQueries } from "@/server/retrieval/query-planner";

export function recognizeQueryIntent(input: AgentQueryInput): QueryIntent {
  const query = input.query.trim();
  const dateRange = parseDateRangeQuery(query);
  const isFollowup = Boolean(input.followupContext) && (
    query.length <= 24 || /^(那|那么|这个|它|还有|具体|为什么|然后|后来|再说|继续)|刚才|上面|前面|其中/i.test(query)
  );
  const kind = detectKind(query, Boolean(dateRange), isFollowup);
  const scope = input.searchMode === "all" || /所有项目|全部主题|全库|跨项目|所有记录/.test(query) ? "all" : "project";
  const requiresRawDetail = /原文|原话|完整内容|上下文|具体怎么说|当时怎么说|哪段对话|哪次对话|细节/.test(query);
  const requiresExternalSearch = /联网|网上|外部搜索|最新消息|今天的|实时|当前价格|当前政策|新闻/.test(query);
  const reasons = [
    dateRange ? `识别到时间范围：${dateRange.label}` : undefined,
    isFollowup ? "识别为承接上一轮的追问" : undefined,
    requiresRawDetail ? "问题要求原文或具体细节" : undefined,
    requiresExternalSearch ? "问题要求知识库外的最新信息" : undefined,
    scope === "all" ? "查询范围为全库" : "查询范围为当前主题",
  ].filter((reason): reason is string => Boolean(reason));

  return {
    kind,
    scope,
    isFollowup,
    requiresRawDetail,
    requiresExternalSearch,
    confidence: calculateConfidence(kind, query, Boolean(dateRange), isFollowup),
    keywords: planGrepQueries(query, input.followupContext?.keywords).slice(0, 12),
    dateRange: dateRange ? { start: dateRange.start.toISOString(), end: dateRange.end.toISOString(), label: dateRange.label } : undefined,
    reasons,
  };
}

function detectKind(query: string, hasDateRange: boolean, isFollowup: boolean): QueryIntentKind {
  if (hasDateRange || /什么时候|时间线|经历|做过什么|发生了什么|最近做了/.test(query)) return "timeline";
  if (/比较|对比|区别|差异|哪个更|优缺点|相比/.test(query)) return "compare";
  if (/总结|概括|梳理|归纳|回顾|主要讲了/.test(query)) return "summarize";
  if (/报错|错误|失败|打不开|不能|无法|有问题|怎么修|排查|原因/.test(query)) return "troubleshoot";
  if (/计划|规划|下一步|怎么做|实施|安排|待办/.test(query)) return "plan";
  if (isFollowup) return "followup";
  if (/我.*(说过|提过|聊过|决定|做过)|记得|之前|曾经|历史/.test(query)) return "recall";
  return "fact";
}

function calculateConfidence(kind: QueryIntentKind, query: string, hasDateRange: boolean, isFollowup: boolean): number {
  if (hasDateRange || isFollowup) return 0.95;
  if (kind !== "fact") return 0.86;
  return query.length >= 4 ? 0.72 : 0.58;
}
