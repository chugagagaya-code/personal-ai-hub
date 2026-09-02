export interface ExternalSearchInput {
  query: string;
  maxResults?: number;
}

export async function externalSearch(_input: ExternalSearchInput) {
  return {
    status: "not_configured" as const,
    results: [],
    note: "外部搜索工具接口已预留，接入具体搜索 provider 后启用。",
  };
}
