import fs from "node:fs/promises";
import path from "node:path";
import { MODEL_GATEWAY_CONFIG_PATH } from "@/server/config";

export type ModelSlot = "primary" | "secondary";

export interface StoredModelConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface PublicModelConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

export interface ModelConfigFile {
  primary?: StoredModelConfig;
  secondary?: StoredModelConfig;
  updatedAt?: string;
}

export async function readModelConfigFile(): Promise<ModelConfigFile> {
  try {
    return JSON.parse(await fs.readFile(MODEL_GATEWAY_CONFIG_PATH, "utf8")) as ModelConfigFile;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function getStoredModelConfig(slot: ModelSlot): Promise<StoredModelConfig | undefined> {
  return (await readModelConfigFile())[slot];
}

export async function getPublicModelConfigs(): Promise<Record<ModelSlot, PublicModelConfig>> {
  const file = await readModelConfigFile();
  return {
    primary: toPublicConfig(file.primary),
    secondary: toPublicConfig(file.secondary),
  };
}

export async function saveModelConfigs(input: Partial<Record<ModelSlot, Partial<StoredModelConfig>>>): Promise<Record<ModelSlot, PublicModelConfig>> {
  const current = await readModelConfigFile();
  const next: ModelConfigFile = { ...current, updatedAt: new Date().toISOString() };
  for (const slot of ["primary", "secondary"] as const) {
    if (!input[slot]) continue;
    const previous = current[slot];
    const candidate: StoredModelConfig = {
      provider: input[slot]?.provider?.trim() ?? previous?.provider ?? "",
      baseUrl: normalizeBaseUrl(input[slot]?.baseUrl?.trim() ?? previous?.baseUrl ?? ""),
      model: input[slot]?.model?.trim() ?? previous?.model ?? "",
      apiKey: input[slot]?.apiKey?.trim() || previous?.apiKey || "",
    };
    if ([candidate.provider, candidate.baseUrl, candidate.model, candidate.apiKey].some(Boolean)) validateConfig(candidate, slot);
    next[slot] = candidate;
  }
  await fs.mkdir(path.dirname(MODEL_GATEWAY_CONFIG_PATH), { recursive: true });
  const temporaryPath = `${MODEL_GATEWAY_CONFIG_PATH}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, MODEL_GATEWAY_CONFIG_PATH);
  return getPublicModelConfigs();
}

function toPublicConfig(config: StoredModelConfig | undefined): PublicModelConfig {
  return {
    provider: config?.provider ?? "",
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? "",
    apiKeyConfigured: Boolean(config?.apiKey),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function validateConfig(config: StoredModelConfig, slot: ModelSlot): void {
  if (!config.provider || !config.baseUrl || !config.model || !config.apiKey) throw new Error(`${slot} 模型配置不完整`);
  const url = new URL(config.baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${slot} API 地址必须使用 HTTP 或 HTTPS`);
}
