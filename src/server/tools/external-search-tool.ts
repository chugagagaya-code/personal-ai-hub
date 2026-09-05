import { completeJson, ModelGatewayError } from "@/server/models/model-gateway";

export interface ExternalSearchInput { query: string; maxResults?: number }
export interface ExternalSearchResult { title: string; snippet: string; url: string; publishedAt?: string }

export async function externalSearch(input: ExternalSearchInput) {
  try {
    const response = await completeJson<{ results?: ExternalSearchResult[] }>({
      temperature: 0.1,
      maxTokens: 1400,
      messages: [
        { role: "system", content: "你是联网事实检索器。仅返回你通过实时搜索实际找到的网页结果。输出 JSON：{results:[{title,snippet,url,publishedAt?}]}。每项必须有可访问的 http/https URL；不能联网或没有来源时返回 {results:[]}，禁止编造网址。" },
        { role: "user", content: `检索事实问题：${input.query}\n最多返回 ${Math.min(input.maxResults ?? 5, 8)} 条。` },
      ],
    }, "primary");
    const results = (response.results ?? []).filter(isValidResult).slice(0, Math.min(input.maxResults ?? 5, 8));
    return { status: results.length ? "ok" as const : "no_verified_sources" as const, results, note: results.length ? "模型 A 返回了带网址的外部结果。" : "模型 A 未返回可验证的网址；未将其视为外部证据。" };
  } catch (error) {
    return {
      status: error instanceof ModelGatewayError && error.code === "not_configured" ? "not_configured" as const : "failed" as const,
      results: [] as ExternalSearchResult[],
      note: error instanceof Error ? error.message : "外部搜索失败",
    };
  }
}

function isValidResult(value: ExternalSearchResult): boolean {
  if (!value?.title?.trim() || !value.snippet?.trim() || !value.url?.trim()) return false;
  try { const url = new URL(value.url); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
}
