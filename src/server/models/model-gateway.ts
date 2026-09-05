import { getStoredModelConfig, type ModelSlot } from "@/server/models/model-config-store";

export type ModelMessageRole = "system" | "user" | "assistant";

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface ModelCompletionInput {
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface ModelCompletionResult {
  content: string;
  model: string;
  provider: string;
  latencyMs: number;
  attempts: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

interface OpenAiCompatibleResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

export class ModelGatewayError extends Error {
  constructor(message: string, readonly code: "not_configured" | "timeout" | "http_error" | "invalid_response") {
    super(message);
    this.name = "ModelGatewayError";
  }
}

export async function isModelGatewayConfigured(slot: ModelSlot = "primary"): Promise<boolean> {
  return Boolean(await readGatewayConfig(slot));
}

export async function completeModel(input: ModelCompletionInput, slot: ModelSlot = "primary"): Promise<ModelCompletionResult> {
  const config = await readGatewayConfig(slot);
  if (!config) throw new ModelGatewayError("模型网关尚未配置", "not_configured");

  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxTokens ?? 1200,
          ...(input.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as OpenAiCompatibleResponse;
      if (!response.ok) {
        const message = body.error?.message ?? `模型服务返回 HTTP ${response.status}`;
        if (response.status < 500 && response.status !== 429) throw new ModelGatewayError(message, "http_error");
        throw new Error(message);
      }
      const content = extractContent(body.choices?.[0]?.message?.content);
      if (!content) throw new ModelGatewayError("模型响应中没有可用文本", "invalid_response");
      return {
        content,
        model: body.model ?? config.model,
        provider: config.provider,
        latencyMs: Date.now() - startedAt,
        attempts: attempt,
        usage: body.usage ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
        } : undefined,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof ModelGatewayError) throw error;
      if (attempt > config.maxRetries) {
        if (error instanceof Error && error.name === "AbortError") throw new ModelGatewayError("模型请求超时", "timeout");
        throw new ModelGatewayError(error instanceof Error ? error.message : "模型请求失败", "http_error");
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ModelGatewayError(lastError instanceof Error ? lastError.message : "模型请求失败", "http_error");
}

export async function completeJson<T>(input: Omit<ModelCompletionInput, "responseFormat">, slot: ModelSlot = "primary"): Promise<T> {
  const result = await completeModel({ ...input, responseFormat: "json" }, slot);
  const cleaned = result.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

async function readGatewayConfig(slot: ModelSlot) {
  const stored = await getStoredModelConfig(slot);
  if (stored?.baseUrl && stored.apiKey && stored.model) {
    return {
      ...stored,
      provider: stored.provider || new URL(stored.baseUrl).hostname,
      timeoutMs: clampNumber(process.env.MODEL_GATEWAY_TIMEOUT_MS, 30_000, 1_000, 120_000),
      maxRetries: clampNumber(process.env.MODEL_GATEWAY_MAX_RETRIES, 1, 0, 3),
    };
  }
  if (slot === "secondary") return undefined;
  const baseUrl = process.env.MODEL_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.MODEL_GATEWAY_API_KEY?.trim();
  const model = process.env.MODEL_GATEWAY_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return {
    baseUrl,
    apiKey,
    model,
    provider: process.env.MODEL_GATEWAY_PROVIDER?.trim() || new URL(baseUrl).hostname,
    timeoutMs: clampNumber(process.env.MODEL_GATEWAY_TIMEOUT_MS, 30_000, 1_000, 120_000),
    maxRetries: clampNumber(process.env.MODEL_GATEWAY_MAX_RETRIES, 1, 0, 3),
  };
}

function extractContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("\n").trim();
  return "";
}

function clampNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}
