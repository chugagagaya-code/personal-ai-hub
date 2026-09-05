import path from "node:path";

export const WORKSPACE_ROOT = path.resolve(process.cwd(), "..");
export const DEFAULT_USER_ID = process.env.PERSONAL_AI_USER_ID?.trim() || "local";

function resolveConfiguredPath(value: string | undefined, fallback: string) {
  return value?.trim() ? path.resolve(process.cwd(), value.trim()) : fallback;
}

export const RAW_DATA_DIR = resolveConfiguredPath(
  process.env.PERSONAL_AI_SOURCE_DIR ?? process.env.PERSONAL_AI_RAW_DATA_DIR,
  path.join(WORKSPACE_ROOT, "原始数据"),
);
export const DATA_DIR = resolveConfiguredPath(process.env.PERSONAL_AI_DATA_DIR, path.join(process.cwd(), "data"));
export const USER_DATA_DIR = path.join(DATA_DIR, "users", DEFAULT_USER_ID);
export const NORMALIZED_DIR = path.join(USER_DATA_DIR, "normalized");
export const PROJECTS_DIR = path.join(USER_DATA_DIR, "projects");
export const MEMORY_OVERRIDES_PATH = path.join(USER_DATA_DIR, "memory-overrides.jsonl");
export const MODEL_GATEWAY_CONFIG_PATH = path.join(USER_DATA_DIR, "model-gateway.json");
export const DATABASE_PATH = path.join(USER_DATA_DIR, "hub.sqlite");

export const DEEPSEEK_DIR = path.join(RAW_DATA_DIR, "deepseek_data-2026-09-01");
export const GEMINI_DIR = path.join(RAW_DATA_DIR, "gemini_data");
