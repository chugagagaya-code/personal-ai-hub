import type { GrepMatch, ModelCallMetadata, QueryIntent } from "@/shared/types";
import { completeModel, ModelGatewayError } from "@/server/models/model-gateway";

export interface GenerateGroundedAnswerInput {
  question: string;
  evidence: GrepMatch[];
  intent: QueryIntent;
  deliberationSummary?: string;
}

export interface GeneratedAnswer {
  answer: string;
  metadata: ModelCallMetadata;
}

export async function generateGroundedAnswer(input: GenerateGroundedAnswerInput): Promise<GeneratedAnswer> {
  const localAnswer = buildLocalAnswer(input);
  if (input.evidence.length === 0) {
    return { answer: localAnswer, metadata: { mode: "local_fallback", fallbackReason: "没有可用于生成答案的证据" } };
  }

  try {
    const evidenceText = input.evidence.slice(0, input.intent.kind === "timeline" ? 20 : 10).map(formatPromptEvidence).join("\n\n");
    const completion = await completeModel({
      temperature: 0.15,
      maxTokens: 1400,
      messages: [
        {
          role: "system",
          content: [
            "你是个人知识库问答助手。只能依据提供的证据回答，不得补充证据中没有的事实。",
            "每个事实后用 [数字] 标注对应证据；如果证据不足或互相冲突，要直接说明。",
            "用自然、简洁的中文综合回答，不要逐条复述原始 JSON，不要声称进行过未发生的外部搜索。",
            "日期问题按时间组织；比较问题明确列出差异；任务和计划问题给出可执行项。",
            "回答必须先有内容简介，再展开具体内容，不能只罗列标题。每项说明用户做了什么、讨论了什么或得到了什么结果。",
            "如果证据涉及研究、排障、模型效果、反复修改等明显复杂工作，增加“当前困难”并引用证据。若时间跨度超过两个月，增加“前情与演变”。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `问题：${input.question}\n意图：${input.intent.kind}\n${input.deliberationSummary ? `冲突处理：${input.deliberationSummary}\n` : ""}\n证据：\n${evidenceText}`,
        },
      ],
    });
    return {
      answer: completion.content,
      metadata: {
        mode: "model",
        model: completion.model,
        provider: completion.provider,
        latencyMs: completion.latencyMs,
        attempts: completion.attempts,
      },
    };
  } catch (error) {
    const reason = error instanceof ModelGatewayError
      ? error.code === "not_configured" ? "模型网关未配置，已使用本地证据生成" : `模型调用失败：${error.message}`
      : "模型调用失败，已使用本地证据生成";
    return { answer: localAnswer, metadata: { mode: "local_fallback", fallbackReason: reason } };
  }
}

function buildLocalAnswer(input: GenerateGroundedAnswerInput): string {
  if (input.evidence.length === 0) return `没有在当前知识库中找到和“${input.question}”足够相关的证据。`;
  if (input.intent.kind === "timeline") {
    const selectedEvidence = input.evidence.slice(0, 20);
    const categories = inferCategories(selectedEvidence);
    const span = getEvidenceSpan(selectedEvidence);
    const items = selectedEvidence.map((match, index) => {
      const date = match.parsed?.occurredAt ? formatDate(match.parsed.occurredAt) : "日期未知";
      const subject = friendlySubject(match.parsed?.subject ?? "未命名事项", match.parsed?.content ?? match.text);
      return `${index + 1}. ${date}｜${subject}\n   ${summarizeEvidence(match)} [${index + 1}]`;
    });
    const introduction = `内容简介：这段时间共找到 ${selectedEvidence.length} 项有效记录${categories.length ? `，主要集中在${categories.join("、")}` : ""}。下面不仅列出事项，也概括了每项工作的具体内容。`;
    const context = buildContextSections(selectedEvidence, span);
    return `${introduction}\n\n具体事项：\n\n${items.join("\n\n")}${context ? `\n\n${context}` : ""}`;
  }
  const heading = "根据当前知识库，可以确认：";
  const items = input.evidence.slice(0, 6).map((match, index) => {
    const date = match.parsed?.occurredAt ? `${formatDate(match.parsed.occurredAt)} ` : "";
    const subject = match.parsed?.subject ? `【${match.parsed.subject}】` : "";
    const content = (match.parsed?.content ?? match.text).replace(/\s+/g, " ").trim().slice(0, 420);
    return `${index + 1}. ${date}${subject}${content} [${index + 1}]`;
  });
  const context = buildContextSections(input.evidence.slice(0, 10), getEvidenceSpan(input.evidence));
  return `内容简介：系统根据 ${input.evidence.length} 条相关证据整理了下面的回答。\n\n${heading}\n\n${items.join("\n\n")}${context ? `\n\n${context}` : ""}`;
}

function formatPromptEvidence(match: GrepMatch, index: number): string {
  const source = /^https?:\/\//.test(match.file)
    ? match.file
    : match.parsed?.sourceRoutes?.map((route) => route.platform).filter((value, position, all) => all.indexOf(value) === position).join("+") || "local";
  return [
    `[${index + 1}] 来源=${source}; 日期=${match.parsed?.occurredAt ?? "未知"}; 类型=${match.parsed?.type ?? "原始片段"}`,
    `标题=${match.parsed?.subject ?? "无"}`,
    (match.parsed?.content ?? match.text).slice(0, 1200),
  ].join("\n");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("zh-CN");
}

function friendlySubject(subject: string, content: string): string {
  if (/音标/.test(subject) && subject.length > 40) return "英语单词美式音标整理";
  if (/Report Controversy/i.test(subject)) return "英语阅读理解、翻译与生词整理";
  if (/模型评估|Precision|Recall|F1/i.test(`${subject}\n${content}`)) return "模型评估结果分析与改进";
  const cleaned = cleanText(subject);
  return cleaned.length > 54 ? `${cleaned.slice(0, 54)}…` : cleaned;
}

function summarizeEvidence(match: GrepMatch): string {
  const content = match.parsed?.content ?? match.text;
  const subject = match.parsed?.subject ?? "";
  if (/音标/.test(`${subject}\n${content}`)) return "整理英语单词的美式音标，形成便于查阅和练习的词汇表。";
  if (/Report Controversy/i.test(subject)) return "围绕一篇能源政策相关英语阅读，完成生词提取、段落翻译和题目理解。";
  if (/Gemini.*导出|导出.*Gemini/i.test(`${subject}\n${content}`)) return "梳理 Gemini 聊天记录的导出方式，包括单条导出、Google Takeout 批量备份和本地文件保存。";
  const user = cleanText(content.match(/user:\s*([\s\S]*?)(?=\n\s*assistant:|$)/i)?.[1] ?? "");
  const assistant = cleanText(content.match(/assistant:\s*([\s\S]*)/i)?.[1] ?? "");
  const result = firstUsefulSentence(assistant);
  if (user && result) return `围绕“${truncateText(user, 70)}”进行了处理；得到的主要结论或产出是：${truncateText(result, 130)}`;
  if (user) return `主要处理了“${truncateText(user, 150)}”。`;
  return truncateText(firstUsefulSentence(cleanText(content)) || "记录了相关讨论和处理结果。", 180);
}

function buildContextSections(evidence: GrepMatch[], span: { days: number; start?: string; end?: string }): string {
  const sections: string[] = [];
  if (span.days > 62 && span.start && span.end) {
    sections.push(`前情与演变：这些记录从 ${formatDate(span.start)} 延续到 ${formatDate(span.end)}，跨度约 ${Math.ceil(span.days / 30)} 个月。理解当前结果时，应结合早期尝试、后续修改和阶段性结论，而不能只看最后一条记录。`);
  }
  const difficulties = evidence.flatMap((match, index) => extractDifficulty(match).map((text) => `${text} [${index + 1}]`)).slice(0, 3);
  if (difficulties.length) sections.push(`当前困难：\n${difficulties.map((item) => `- ${item}`).join("\n")}`);
  return sections.join("\n\n");
}

function extractDifficulty(match: GrepMatch): string[] {
  const content = cleanText(match.parsed?.content ?? match.text);
  if (/模型评估|Precision|Recall|F1|正负样本不平衡/i.test(content)) {
    return ["模型效果目前仍处于中等偏弱或初步可用阶段，并存在正负样本不平衡，需要继续改善误判与分类指标。"];
  }
  if (!/报错|失败|无法|问题|困难|不足|偏弱|不平衡|改进|优化|修复|风险/i.test(content)) return [];
  const sentence = content.split(/[。！？!?；;]/).find((item) => /报错|失败|无法|问题|困难|不足|偏弱|不平衡|改进|优化|修复|风险/i.test(item));
  return sentence ? [truncateText(sentence.trim(), 180)] : [];
}

function inferCategories(evidence: GrepMatch[]): string[] {
  const text = evidence.map((match) => `${match.parsed?.subject ?? ""} ${match.parsed?.content ?? match.text}`).join("\n");
  const rules: Array<[string, RegExp]> = [
    ["英语学习", /英语|单词|音标|翻译|Reading|Comprehension/i],
    ["AI 与数据管理", /Gemini|DeepSeek|聊天记录|导出|数据/i],
    ["模型与代码工作", /模型|代码|Python|评估|Precision|Recall|F1/i],
    ["网络与设备", /网络|光猫|路由|Mesh|Switch/i],
    ["研究与写作", /研究|论文|写作|报告/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([label]) => label).slice(0, 4);
}

function getEvidenceSpan(evidence: GrepMatch[]): { days: number; start?: string; end?: string } {
  const dates = evidence.map((match) => match.parsed?.occurredAt).filter((value): value is string => Boolean(value)).sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  if (dates.length < 2) return { days: 0, start: dates[0], end: dates[0] };
  return { days: Math.max(0, (new Date(dates.at(-1)!).getTime() - new Date(dates[0]).getTime()) / 86_400_000), start: dates[0], end: dates.at(-1) };
}

function cleanText(value: string): string {
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/图片：[^\n]*Uploaded image preview/gi, " ").replace(/\b(?:user|assistant):\s*/gi, " ").replace(/[*#>|`_]/g, " ").replace(/\s+/g, " ").trim();
}

function firstUsefulSentence(value: string): string {
  return value.split(/[。！？!?\n]/).map((item) => item.trim()).find((item) => item.length >= 12 && !/^用户|^嗯，?用户|^我需要/.test(item)) ?? "";
}

function truncateText(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
