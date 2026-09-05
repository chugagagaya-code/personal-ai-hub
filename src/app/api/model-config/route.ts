import { NextResponse } from "next/server";
import { getPublicModelConfigs, saveModelConfigs, type ModelSlot, type StoredModelConfig } from "@/server/models/model-config-store";
import { recordAudit } from "@/server/database/audit";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, result: await getPublicModelConfigs() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "模型配置读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<Record<ModelSlot, Partial<StoredModelConfig>>>;
    const result = await saveModelConfigs({ primary: body.primary, secondary: body.secondary });
    recordAudit("model_config.updated", "model_config", undefined, { primary: result.primary.apiKeyConfigured, secondary: result.secondary.apiKeyConfigured });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "模型配置保存失败" }, { status: 400 });
  }
}
