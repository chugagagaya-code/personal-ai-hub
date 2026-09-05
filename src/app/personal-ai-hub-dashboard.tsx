"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AgentAnswer,
  MemoryRecord,
  MemoryCandidate,
  MemoryType,
  Project,
  SourceLookupResult,
  SourceRoute,
  TopicOverview,
} from "@/shared/types";

type ApiState = "idle" | "loading" | "success" | "error";
type RightPanelMode = "evidence" | "new" | "library";

interface ProjectsResponse {
  ok: boolean;
  result: Project[];
  error?: string;
}

interface MemoriesResponse {
  ok: boolean;
  result: MemoryRecord[];
  error?: string;
}

interface AgentResponse {
  ok: boolean;
  result: AgentAnswer;
  error?: string;
}

interface SourceResponse {
  ok: boolean;
  result: SourceLookupResult;
  error?: string;
}

interface TopicOverviewResponse {
  ok: boolean;
  result: TopicOverview;
  error?: string;
}

interface ModelSlotForm {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeyConfigured: boolean;
}

interface ModelConfigResponse {
  ok: boolean;
  result: { primary: Omit<ModelSlotForm, "apiKey">; secondary: Omit<ModelSlotForm, "apiKey"> };
  error?: string;
}

interface JobRecord { id: string; status: "pending" | "running" | "completed" | "failed"; result?: { projectCount?: number; messageCount?: number }; error?: string }
interface AuditEvent { id: number; action: string; entityType: string; entityId?: string; details: Record<string, unknown>; createdAt: string }

const memoryTypes: Array<"all" | MemoryType> = ["all", "conversation", "decision", "task", "problem", "knowledge"];
const ALL_LIBRARY_ID = "__all__";
const WELCOME_QUERY = "(*^▽^*)欢迎使用个人AI中心。";
const emptyModelSlot = (): ModelSlotForm => ({ provider: "", baseUrl: "", model: "", apiKey: "", apiKeyConfigured: false });

export function PersonalAiHubDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(ALL_LIBRARY_ID);
  const [selectedMemoryType, setSelectedMemoryType] = useState<"all" | MemoryType>("all");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [query, setQuery] = useState(WELCOME_QUERY);
  const [searchMode, setSearchMode] = useState<"project" | "all">("all");
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [projectsState, setProjectsState] = useState<ApiState>("idle");
  const [memoriesState, setMemoriesState] = useState<ApiState>("idle");
  const [queryState, setQueryState] = useState<ApiState>("idle");
  const [importState, setImportState] = useState<ApiState>("idle");
  const [sourceState, setSourceState] = useState<ApiState>("idle");
  const [sourceLookup, setSourceLookup] = useState<SourceLookupResult | null>(null);
  const [topicOverview, setTopicOverview] = useState<TopicOverview | null>(null);
  const [topicOverviewState, setTopicOverviewState] = useState<ApiState>("idle");
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [modelConfigState, setModelConfigState] = useState<ApiState>("idle");
  const [modelConfigs, setModelConfigs] = useState({ primary: emptyModelSlot(), secondary: emptyModelSlot() });
  const [showAudit, setShowAudit] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("evidence");
  const [handledCandidateIds, setHandledCandidateIds] = useState<string[]>([]);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    setSelectedMemoryIds([]);
    if (selectedProjectId) void loadMemories(selectedProjectId, selectedMemoryType, showInactive);
  }, [selectedProjectId, selectedMemoryType, showInactive]);

  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== ALL_LIBRARY_ID) {
      void loadTopicOverview(selectedProjectId);
    } else {
      setTopicOverview(null);
      setTopicOverviewState("idle");
    }
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const isAllLibrary = selectedProjectId === ALL_LIBRARY_ID;

  const memoryCounts = useMemo(() => {
    return memories.reduce<Record<string, number>>((counts, memory) => {
      counts[memory.type] = (counts[memory.type] ?? 0) + 1;
      return counts;
    }, {});
  }, [memories]);

  async function loadProjects() {
    setProjectsState("loading");
    const data = await fetchJson<ProjectsResponse>("/api/projects");
    if (!data.ok) {
      setProjectsState("error");
      setMessage(data.error ?? "项目加载失败");
      return;
    }

    setProjects(data.result);
    if (selectedProjectId !== ALL_LIBRARY_ID && data.result.length > 0 && !data.result.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(data.result[0].id);
    }
    setProjectsState("success");
  }

  async function loadMemories(projectId: string, type: "all" | MemoryType, includeInactive = showInactive) {
    setMemoriesState("loading");
    const params = new URLSearchParams({ limit: "80" });
    if (projectId === ALL_LIBRARY_ID) params.set("scope", "all");
    else params.set("projectId", projectId);
    if (type !== "all") params.set("type", type);
    if (includeInactive) params.set("includeInactive", "true");

    const data = await fetchJson<MemoriesResponse>(`/api/memories?${params.toString()}`);
    if (!data.ok) {
      setMemoriesState("error");
      setMessage(data.error ?? "记忆加载失败");
      return;
    }

    setMemories(data.result);
    setMemoriesState("success");
  }

  function selectAllLibrary() {
    setSelectedProjectId(ALL_LIBRARY_ID);
    setSearchMode("all");
    setAnswer(null);
  }

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSearchMode("project");
    setAnswer(null);
  }

  async function loadTopicOverview(projectId: string) {
    setTopicOverviewState("loading");
    setTopicOverview(null);
    const data = await fetchJson<TopicOverviewResponse>(`/api/topics/${encodeURIComponent(projectId)}/overview`);
    if (!data.ok) {
      setTopicOverviewState("error");
      return;
    }
    setTopicOverview(data.result);
    setTopicOverviewState("success");
  }

  async function runImport() {
    setImportState("loading");
    setMessage("正在重新导入 DeepSeek JSON 和 Gemini Markdown...");
    const data = await fetchJson<{ ok: boolean; result?: JobRecord; error?: string }>(
      "/api/imports",
      { method: "POST" },
    );

    if (!data.ok) {
      setImportState("error");
      setMessage(data.error ?? "导入失败");
      return;
    }

    if (!data.result) return;
    const job = await waitForJob(data.result.id, (status) => setMessage(status === "running" ? "正在后台导入并重建主题..." : "导入任务已排队..."));
    if (job.status === "failed") {
      setImportState("error");
      setMessage(job.error ?? "导入任务失败");
      return;
    }
    setImportState("success");
    setMessage(`导入完成：${job.result?.messageCount ?? 0} 条消息，${job.result?.projectCount ?? 0} 个主题。`);
    await loadProjects();
    await loadMemories(selectedProjectId, selectedMemoryType, showInactive);
  }

  async function editSelectedProject() {
    if (!selectedProject) return;
    const name = window.prompt("主题名称", selectedProject.name);
    if (name === null) return;
    const description = window.prompt("主题描述", selectedProject.description ?? "");
    if (description === null) return;
    const data = await fetchJson<{ ok: boolean; error?: string }>("/api/projects", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: selectedProject.id, name, description }),
    });
    if (!data.ok) return setMessage(data.error ?? "主题修改失败");
    setMessage("主题人工修正已保存，重新导入后仍会保留。");
    await loadProjects();
  }

  async function reassignConversation(conversationId: string) {
    const choice = window.prompt("输入目标主题名称或 ID", projects.map((project) => project.name).join("\n"));
    if (!choice) return;
    const target = projects.find((project) => project.id === choice.trim() || project.name === choice.trim());
    if (!target) return setMessage("没有找到这个目标主题。");
    const data = await fetchJson<{ ok: boolean; result?: { job: JobRecord }; error?: string }>("/api/projects/assign", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, projectId: target.id }),
    });
    if (!data.ok || !data.result) return setMessage(data.error ?? "移动对话失败");
    setMessage("人工归类已保存，正在后台重建主题库...");
    const job = await waitForJob(data.result.job.id);
    if (job.status === "failed") return setMessage(job.error ?? "重建失败");
    await loadProjects();
    await loadMemories(selectedProjectId, selectedMemoryType, showInactive);
    await loadTopicOverview(selectedProjectId);
    setMessage(`对话已移动到“${target.name}”。`);
  }

  async function openAudit() {
    const data = await fetchJson<{ ok: boolean; result: AuditEvent[]; error?: string }>("/api/audit?limit=100");
    if (!data.ok) return setMessage(data.error ?? "审计记录加载失败");
    setAuditEvents(data.result);
    setShowAudit(true);
  }

  async function openModelConfig() {
    setShowModelConfig(true);
    setModelConfigState("loading");
    const data = await fetchJson<ModelConfigResponse>("/api/model-config");
    if (!data.ok) {
      setModelConfigState("error");
      setMessage(data.error ?? "模型配置读取失败");
      return;
    }
    setModelConfigs({
      primary: { ...data.result.primary, apiKey: "" },
      secondary: { ...data.result.secondary, apiKey: "" },
    });
    setModelConfigState("success");
  }

  function updateModelSlot(slot: "primary" | "secondary", field: keyof ModelSlotForm, value: string) {
    setModelConfigs((current) => ({ ...current, [slot]: { ...current[slot], [field]: value } }));
  }

  async function saveModelConfig() {
    setModelConfigState("loading");
    const data = await fetchJson<ModelConfigResponse>("/api/model-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary: stripPublicFields(modelConfigs.primary),
        secondary: stripPublicFields(modelConfigs.secondary),
      }),
    });
    if (!data.ok) {
      setModelConfigState("error");
      setMessage(data.error ?? "模型配置保存失败");
      return;
    }
    setModelConfigState("success");
    setShowModelConfig(false);
    setMessage("双 LLM 模型配置已保存到本机私有数据目录。");
  }

  async function askAgent() {
    const trimmed = query.trim();
    if (!trimmed) return;

    setQueryState("loading");
    setMessage("");
    const data = await fetchJson<AgentResponse>("/api/agent/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: trimmed,
        searchMode,
        projectIds: searchMode === "project" && selectedProjectId !== "unassigned" ? [selectedProjectId] : undefined,
      }),
    });

    if (!data.ok) {
      setQueryState("error");
      setMessage(data.error ?? "查询失败");
      return;
    }

    setAnswer(data.result);
    setHandledCandidateIds([]);
    setRightPanelMode("evidence");
    setQueryState("success");
  }

  async function saveMemoryCandidate(candidate: MemoryCandidate) {
    let targetProjectId = candidate.projectId;
    if (isAllLibrary) {
      const suggested = projects.find((project) => project.id === candidate.projectId);
      const choice = window.prompt(
        "请选择这条记忆要保存到哪个主题（输入主题名称或 ID）",
        suggested?.name ?? projects[0]?.name ?? "",
      );
      if (!choice) return;
      const target = projects.find((project) => project.id === choice.trim() || project.name === choice.trim());
      if (!target) return setMessage("没有找到这个目标主题，候选尚未保存。");
      targetProjectId = target.id;
    }
    const data = await fetchJson<{ ok: boolean; error?: string }>("/api/memories/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        targetMemoryIds: [],
        replacement: {
          projectId: targetProjectId,
          type: candidate.type,
          subject: candidate.subject,
          content: candidate.content,
          keywords: [],
          sourceRoutes: [],
          occurredAt: candidate.createdAt,
        },
        reason: "用户确认保存本轮问答记忆",
      }),
    });
    if (!data.ok) return setMessage(data.error ?? "候选记忆保存失败");
    setHandledCandidateIds((current) => [...current, candidate.id]);
    setMessage("本轮候选已保存到长期记忆库。");
    await loadMemories(selectedProjectId, selectedMemoryType, showInactive);
  }

  async function openSource(route: SourceRoute | undefined) {
    if (!route) {
      setMessage("这条记忆没有可回查的原始来源。");
      return;
    }

    setSourceState("loading");
    setSourceLookup(null);
    const data = await fetchJson<SourceResponse>("/api/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route }),
    });

    if (!data.ok) {
      setSourceState("error");
      setMessage(data.error ?? "原始来源读取失败");
      return;
    }

    setSourceLookup(data.result);
    setSourceState("success");
  }

  function closeSource() {
    setSourceLookup(null);
    setSourceState("idle");
  }

  async function mutateMemory(action: "update" | "ignore" | "supersede" | "merge", targets: MemoryRecord[]) {
    if (targets.length === 0) return;

    const primary = targets[0];
    const body: Record<string, unknown> = {
      action,
      targetMemoryIds: targets.map((target) => target.id),
    };

    if (action === "update") {
      const subject = window.prompt("新的记忆标题", primary.subject);
      if (subject === null) return;
      const content = window.prompt("新的记忆内容", primary.content);
      if (content === null) return;
      body.patch = { subject, content };
    }

    if (action === "ignore") {
      const reason = window.prompt("废弃原因", "误抽取或不再需要");
      if (reason === null) return;
      body.reason = reason;
    }

    if (action === "supersede" || action === "merge") {
      const subject = window.prompt(action === "merge" ? "合并后的记忆标题" : "替代后的记忆标题", primary.subject);
      if (subject === null) return;
      const content = window.prompt(
        action === "merge" ? "合并后的记忆内容" : "替代后的记忆内容",
        targets.map((target) => target.content).join("\n\n"),
      );
      if (content === null) return;
      body.replacement = {
        projectId: primary.projectId,
        type: primary.type === "conversation" ? "knowledge" : primary.type,
        subject,
        content,
        keywords: [],
        sourceRoutes: targets.flatMap((target) => target.sourceRoutes),
        occurredAt: targets.map((target) => target.occurredAt).filter(Boolean).sort()[0],
      };
    }

    const data = await fetchJson<{ ok: boolean; error?: string }>("/api/memories/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!data.ok) {
      setMessage(data.error ?? "记忆操作失败");
      return;
    }

    setMessage("记忆状态已更新。");
    setSelectedMemoryIds([]);
    await loadMemories(selectedProjectId, selectedMemoryType, showInactive);
  }

  function toggleMemorySelection(memoryId: string) {
    setSelectedMemoryIds((current) =>
      current.includes(memoryId) ? current.filter((id) => id !== memoryId) : [...current, memoryId],
    );
  }

  return (
    <main className="workspace">
      <div className="shell">
        <aside className="panel library-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Topics</p>
              <h1 className="title">个人人工智能中心</h1>
            </div>
            <div className="header-actions">
              <button className="secondary-button" type="button" onClick={openModelConfig}>模型配置</button>
              <button className="secondary-button" type="button" onClick={openAudit}>审计记录</button>
              <button className="secondary-button" disabled={importState === "loading"} onClick={runImport}>
                {importState === "loading" ? "导入中" : "重新导入"}
              </button>
            </div>
          </div>

          {message ? <div className={`message ${projectsState === "error" ? "error" : ""}`}>{message}</div> : null}

          <div className="sidebar-body">
            <div className="project-list">
              <button
                className={`project-button library-button ${isAllLibrary ? "active" : ""}`}
                type="button"
                onClick={selectAllLibrary}
              >
                <span className="project-name">
                  我的全库
                  <span className="badge">ALL</span>
                </span>
                <span className="project-desc">跨全部主题检索和浏览记忆</span>
              </button>
              {projectsState === "loading" && projects.length === 0 ? <p className="empty">正在加载项目...</p> : null}
              {projects.map((project) => (
                <button
                  className={`project-button ${project.id === selectedProjectId ? "active" : ""}`}
                  key={project.id}
                  onClick={() => selectProject(project.id)}
                >
                  <span className="project-name">
                    {project.name}
                    <span className="badge">P{project.priority ?? 0}</span>
                  </span>
                  <span className="project-desc">{project.description ?? project.aliases.join(", ")}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="panel main-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Agent Workspace</p>
              <h2 className="title">{isAllLibrary ? "我的全库" : selectedProject?.name ?? "选择一个项目"}</h2>
            </div>
            <div className="workspace-actions">
              {!isAllLibrary ? <button className="mini-button" type="button" onClick={editSelectedProject}>编辑主题</button> : null}
              <span className="badge">{answer?.usedFallbackRawSearch ? "已回退原始库" : "分类库优先"}</span>
            </div>
          </div>

          <div className="query-box">
            <textarea
              value={query}
              onFocus={() => setQuery((current) => current === WELCOME_QUERY ? "" : current)}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="toolbar">
              <div className="segmented" aria-label="查询模式">
                <button
                  className="active"
                  type="button"
                  disabled
                >
                  {isAllLibrary ? "全库查询" : "主题内查询"}
                </button>
                <button type="button" disabled>
                  事实问题自动外搜
                </button>
              </div>
              <button className="primary-button" disabled={queryState === "loading"} onClick={askAgent}>
                {queryState === "loading" ? "查询中" : "询问智能体"}
              </button>
            </div>
          </div>

          <div className="status-strip">
            <Metric label="主题数" value={projects.length} />
            <Metric label="显示记忆" value={memories.length} />
            <Metric label="结构化" value={memories.length - (memoryCounts.conversation ?? 0)} />
            <Metric label="证据数" value={answer?.evidence.length ?? 0} />
          </div>

          {topicOverview ? <TopicOverviewCard overview={topicOverview} onOpenSource={openSource} onReassign={reassignConversation} /> : null}
          {topicOverviewState === "loading" ? <p className="topic-loading">正在整理主题概览...</p> : null}

          <div className="main-body">
            <div className="answer-area">
              {answer ? (
                <article className="answer-card">
                  <div className="memory-meta">
                    <span className="badge">{answer.status}</span>
                    <span className="badge">{answer.usedFallbackRawSearch ? "raw fallback" : "classified only"}</span>
                    {answer.intent ? <span className="badge">intent: {answer.intent.kind}</span> : null}
                    {answer.generation ? (
                      <span className="badge">
                        {answer.generation.mode === "model" ? `${answer.generation.provider} · ${answer.generation.model}` : "本地生成"}
                      </span>
                    ) : null}
                    {answer.deliberation ? <span className="badge">argue ready</span> : null}
                  </div>
                  <pre>{answer.answer}</pre>
                  {answer.generation?.fallbackReason ? <p className="generation-note">{answer.generation.fallbackReason}</p> : null}
                </article>
              ) : (
                <p className="empty">
                  {isAllLibrary
                    ? "输入问题后，智能体会检索全部主题；细节不够时再回到原始库。"
                    : "输入问题后，智能体会先查当前主题的分类知识库；细节不够时再回到原始库。"}
                </p>
              )}

              {sourceState === "loading" ? <p className="empty">正在读取原始来源...</p> : null}
            </div>
          </div>
        </section>

        <aside className="panel evidence-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Memory & Evidence</p>
              <h2 className="section-title">{rightPanelMode === "evidence" ? "本次回答依据" : rightPanelMode === "new" ? "本轮新增记忆" : "记忆库管理"}</h2>
            </div>
            <span className="badge">{rightPanelMode === "evidence" ? answer?.evidence.length ?? 0 : rightPanelMode === "new" ? answer?.memoryCandidates?.length ?? 0 : memories.length}</span>
          </div>

          <div className="right-panel-tabs" aria-label="右侧面板">
            <button className={rightPanelMode === "evidence" ? "active" : ""} onClick={() => setRightPanelMode("evidence")}>回答依据</button>
            <button className={rightPanelMode === "new" ? "active" : ""} onClick={() => setRightPanelMode("new")}>
              本轮新增{answer?.memoryCandidates?.length ? ` ${answer.memoryCandidates.length}` : ""}
            </button>
            <button className={rightPanelMode === "library" ? "active" : ""} onClick={() => setRightPanelMode("library")}>记忆库</button>
          </div>

          {rightPanelMode === "library" ? <div className="type-tabs">
            {memoryTypes.map((type) => (
              <button
                className={type === selectedMemoryType ? "active" : ""}
                key={type}
                onClick={() => setSelectedMemoryType(type)}
              >
                {type}
              </button>
            ))}
          </div> : null}

          {rightPanelMode === "library" ? <label className="inactive-toggle">
            <input checked={showInactive} type="checkbox" onChange={(event) => setShowInactive(event.target.checked)} />
            显示已废弃 / 已合并 / 已替代
          </label> : null}

          {rightPanelMode === "library" && selectedMemoryIds.length > 0 ? (
            <div className="bulk-actions">
              <span className="badge">已选 {selectedMemoryIds.length}</span>
              <button
                className="mini-button"
                type="button"
                onClick={() => mutateMemory("merge", memories.filter((memory) => selectedMemoryIds.includes(memory.id)))}
              >
                合并
              </button>
              <button
                className="mini-button"
                type="button"
                onClick={() => mutateMemory("ignore", memories.filter((memory) => selectedMemoryIds.includes(memory.id)))}
              >
                废弃
              </button>
            </div>
          ) : null}

          <div className="evidence-body">
            {rightPanelMode === "library" ? <div className="memory-list">
              {memories.slice(0, 12).map((memory) => (
                <article className="memory-card" key={memory.id}>
                  <div className="memory-meta">
                    <label className="select-memory">
                      <input
                        checked={selectedMemoryIds.includes(memory.id)}
                        type="checkbox"
                        onChange={() => toggleMemorySelection(memory.id)}
                      />
                    </label>
                    <span className="badge">{memory.type}</span>
                    <span className="badge">{memory.status}</span>
                    <span className="badge">{memory.extractionMethod}</span>
                    <span className="badge">{formatPlatforms(memory.sourceRoutes)}</span>
                    <span className="badge">{Math.round(memory.confidence * 100)}%</span>
                    <span className="badge">{formatDate(memory.occurredAt ?? memory.createdAt)}</span>
                  </div>
                  <h3>{memory.subject}</h3>
                  <p>{truncate(memory.content, 220)}</p>
                  <div className="memory-actions">
                    <button className="inline-link" type="button" onClick={() => openSource(memory.sourceRoutes[0])}>
                      查看原文
                    </button>
                    <button className="inline-link" type="button" onClick={() => mutateMemory("update", [memory])}>
                      更新
                    </button>
                    <button className="inline-link" type="button" onClick={() => mutateMemory("supersede", [memory])}>
                      替代
                    </button>
                    <button className="inline-link danger-link" type="button" onClick={() => mutateMemory("ignore", [memory])}>
                      废弃
                    </button>
                  </div>
                </article>
              ))}
              {memoriesState === "success" && memories.length === 0 ? <p className="empty">这个筛选下暂时没有 memory。</p> : null}
            </div> : null}

            {rightPanelMode === "evidence" ? (
              answer?.evidence.length ? (
                <div className="evidence-list">
                  {answer.evidence.map((item, index) => (
                    <article className="evidence-card" key={`${item.file}-${item.line}-${item.query}`}>
                      <div className="evidence-meta">
                        <span className={`badge source-kind ${item.sourceKind ?? "classified"}`}>{formatEvidenceSource(item)}</span>
                        {item.parsed?.type ? <span className="badge">{item.parsed.type}</span> : null}
                        {item.parsed?.sourceRoutes?.length ? (
                          <span className="badge">{formatPlatforms(item.parsed.sourceRoutes)}</span>
                        ) : null}
                        {item.parsed?.occurredAt ? <span className="badge">{formatDate(item.parsed.occurredAt)}</span> : null}
                      </div>
                      <h3>{item.parsed?.subject ?? `依据 ${index + 1}`}</h3>
                      <p className="match-reason">{formatMatchReason(item)}</p>
                      <p>{truncate(formatEvidence(item), 260)}</p>
                      {/^https?:\/\//.test(item.file) ? (
                        <a className="inline-link" href={item.file} target="_blank" rel="noreferrer">查看外部来源</a>
                      ) : (
                        <button className="inline-link" type="button" onClick={() => openSource(item.parsed?.sourceRoutes?.[0])}>查看原文</button>
                      )}
                    </article>
                  ))}
                </div>
              ) : <div className="panel-empty-state"><strong>{queryState === "loading" ? "正在检索本次回答依据…" : "等待提问"}</strong><p>提问后，这里只显示真正参与本次回答的记忆、原文回查和外部来源。</p></div>
            ) : null}

            {rightPanelMode === "new" ? (
              answer ? answer.memoryCandidates?.length ? (
                <div className="memory-list">
                  <p className="candidate-note">以下内容只是候选，不会自动写入长期记忆。确认有长期价值后再保存。</p>
                  {answer.memoryCandidates.map((candidate) => {
                    const handled = handledCandidateIds.includes(candidate.id);
                    return <article className="memory-card" key={candidate.id}>
                      <div className="memory-meta"><span className="badge">候选</span><span className="badge">{candidate.type}</span><span className="badge">{Math.round(candidate.confidence * 100)}%</span></div>
                      <h3>{candidate.subject}</h3>
                      <p>{truncate(candidate.content, 320)}</p>
                      <div className="memory-actions">
                        <button className="mini-button" disabled={handled} type="button" onClick={() => saveMemoryCandidate(candidate)}>{handled ? "已保存" : "保存到记忆库"}</button>
                        {!handled ? <button className="inline-link danger-link" type="button" onClick={() => setHandledCandidateIds((current) => [...current, candidate.id])}>忽略</button> : null}
                      </div>
                    </article>;
                  })}
                </div>
              ) : <div className="panel-empty-state"><strong>本轮没有适合长期保存的内容</strong><p>普通查询不会被强行记住；明确的任务、决策或问题才会生成待确认候选。</p></div>
              : <div className="panel-empty-state"><strong>尚未产生新记忆</strong><p>完成一次提问后，候选记忆会显示在这里。</p></div>
            ) : null}
          </div>
        </aside>
      </div>

      {showModelConfig ? (
        <div className="source-overlay" role="dialog" aria-modal="true" aria-label="双 LLM 模型配置">
          <article className="source-card model-config-card">
            <div className="source-card-header">
              <div>
                <p className="eyebrow">Model Gateway</p>
                <h3>双 LLM 模型配置</h3>
              </div>
              <button className="mini-button" type="button" onClick={() => setShowModelConfig(false)}>关闭</button>
            </div>
            <p className="model-config-note">使用 OpenAI-compatible API。密钥保存在本机 data 目录，页面不会回显已保存的密钥。</p>
            <div className="model-config-grid">
              <ModelSlotFields label="模型 A · 主回答" slot="primary" value={modelConfigs.primary} onChange={updateModelSlot} />
              <ModelSlotFields label="模型 B · 复核辩论" slot="secondary" value={modelConfigs.secondary} onChange={updateModelSlot} />
            </div>
            <div className="model-config-actions">
              <button className="secondary-button" type="button" onClick={() => setShowModelConfig(false)}>取消</button>
              <button className="primary-button" disabled={modelConfigState === "loading"} type="button" onClick={saveModelConfig}>
                {modelConfigState === "loading" ? "保存中" : "保存配置"}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {showAudit ? (
        <div className="source-overlay" role="dialog" aria-modal="true" aria-label="审计记录">
          <article className="source-card audit-card">
            <div className="source-card-header"><div><p className="eyebrow">Audit</p><h3>审计记录</h3></div><button className="mini-button" type="button" onClick={() => setShowAudit(false)}>关闭</button></div>
            <div className="audit-list">
              {auditEvents.map((event) => <div className="audit-row" key={event.id}><strong>{auditActionLabel(event.action)}</strong><span>{event.entityType}{event.entityId ? ` · ${event.entityId}` : ""}</span><time>{formatDate(event.createdAt)}</time></div>)}
              {auditEvents.length === 0 ? <p className="empty">尚无审计记录。</p> : null}
            </div>
          </article>
        </div>
      ) : null}

      {sourceLookup || sourceState === "loading" ? (
        <div className="source-overlay" role="dialog" aria-modal="true" aria-label="原始来源">
          <article className="source-card">
            {sourceLookup ? (
              <>
                <div className="source-card-header">
                  <div>
                    <p className="eyebrow">Original Source</p>
                    <h3>{sourceLookup.title ?? "原始片段"}</h3>
                  </div>
                  <div className="memory-meta">
                    <span className="badge">{formatPlatformName(sourceLookup.route.platform)}</span>
                    {sourceLookup.createdAt ? <span className="badge">{formatDate(sourceLookup.createdAt)}</span> : null}
                    <button className="mini-button" type="button" onClick={closeSource}>
                      关闭
                    </button>
                  </div>
                </div>
                <pre>{sourceLookup.content}</pre>
                {sourceLookup.nearbyMessages?.length ? (
                  <div className="nearby-list">
                    <h4>上下文</h4>
                    {sourceLookup.nearbyMessages.map((item, index) => (
                      <div className="nearby-item" key={`${item.messageId ?? index}-${item.createdAt ?? index}`}>
                        <div className="memory-meta">
                          <span className="badge">{item.role}</span>
                          {item.createdAt ? <span className="badge">{formatDate(item.createdAt)}</span> : null}
                        </div>
                        <p>{truncate(item.content, 320)}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="empty">正在读取原始来源...</p>
            )}
          </article>
        </div>
      ) : null}
    </main>
  );
}

function ModelSlotFields({
  label,
  slot,
  value,
  onChange,
}: {
  label: string;
  slot: "primary" | "secondary";
  value: ModelSlotForm;
  onChange: (slot: "primary" | "secondary", field: keyof ModelSlotForm, value: string) => void;
}) {
  return (
    <section className="model-slot">
      <h4>{label}</h4>
      <label>供应商名称<input value={value.provider} onChange={(event) => onChange(slot, "provider", event.target.value)} placeholder="例如 DeepSeek" /></label>
      <label>API 根地址<input value={value.baseUrl} onChange={(event) => onChange(slot, "baseUrl", event.target.value)} placeholder="https://.../v1" /></label>
      <label>模型名称<input value={value.model} onChange={(event) => onChange(slot, "model", event.target.value)} placeholder="模型 ID" /></label>
      <label>
        API Key
        <input type="password" value={value.apiKey} onChange={(event) => onChange(slot, "apiKey", event.target.value)} placeholder={value.apiKeyConfigured ? "已保存；留空则保持不变" : "输入 API Key"} autoComplete="off" />
      </label>
      <span className={`model-config-status ${value.apiKeyConfigured ? "configured" : ""}`}>
        {value.apiKeyConfigured ? "密钥已配置" : "尚未配置密钥"}
      </span>
    </section>
  );
}

function TopicOverviewCard({
  overview,
  onOpenSource,
  onReassign,
}: {
  overview: TopicOverview;
  onOpenSource: (route: SourceRoute) => void;
  onReassign: (conversationId: string) => void;
}) {
  const maxTermSupport = Math.max(1, ...overview.profile.topTerms.map((item) => item.supportConversationCount));
  const memoryTotal = Object.values(overview.memoryTypeCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  const maxMonthCount = Math.max(1, ...overview.monthlyConversationCounts.map((item) => item.count));
  const memoryOrder: MemoryType[] = ["conversation", "task", "knowledge", "problem", "decision", "event"];
  const conversations = uniqueConversations([
    ...overview.profile.representativeConversations,
    ...overview.profile.recentConversations,
  ]).slice(0, 7);

  return (
    <section className="topic-overview" aria-labelledby="topic-overview-title">
      <div className="topic-overview-heading">
        <div>
          <p className="eyebrow">Topic Overview</p>
          <h3 id="topic-overview-title">主题概览</h3>
        </div>
        <span className="badge">{overview.profile.conversationCount} 段对话</span>
      </div>
      <p className="topic-description">{overview.profile.description}</p>

      <div className="topic-visual-grid">
        <section className="topic-chart" aria-label="关键词强度">
          <h4>关键词强度</h4>
          <div className="term-bars">
            {overview.profile.topTerms.slice(0, 6).map((item) => (
              <div className="term-row" key={item.term}>
                <span>{item.term}</span>
                <div className="chart-track" aria-hidden="true">
                  <span style={{ width: `${(item.supportConversationCount / maxTermSupport) * 100}%` }} />
                </div>
                <strong>{Math.round(item.supportRatio * 100)}%</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="topic-chart" aria-label="记忆构成">
          <h4>记忆构成</h4>
          <div className="memory-stack" aria-label={`共 ${memoryTotal} 条记忆`}>
            {memoryOrder.map((type) => {
              const count = overview.memoryTypeCounts[type] ?? 0;
              return count > 0 ? <span className={`memory-segment memory-${type}`} key={type} style={{ width: `${(count / Math.max(1, memoryTotal)) * 100}%` }} /> : null;
            })}
          </div>
          <div className="memory-legend">
            {memoryOrder.map((type) => {
              const count = overview.memoryTypeCounts[type] ?? 0;
              return count > 0 ? <span key={type}><i className={`memory-dot memory-${type}`} />{memoryTypeLabel(type)} {count}</span> : null;
            })}
          </div>
        </section>

        <section className="topic-chart topic-time-chart" aria-label="按月统计的对话时间分布">
          <h4>时间分布</h4>
          {overview.monthlyConversationCounts.length ? (
            <div className="month-bars">
              {overview.monthlyConversationCounts.slice(-18).map((item) => (
                <div className="month-column" key={item.month}>
                  <span className="month-value">{item.count}</span>
                  <div className="month-track"><span style={{ height: `${Math.max(8, (item.count / maxMonthCount) * 100)}%` }} /></div>
                  <span className="month-label">{item.month.slice(2)}</span>
                </div>
              ))}
            </div>
          ) : <p className="empty compact-empty">没有可用日期</p>}
        </section>

        <section className="topic-chart topic-conversation-list" aria-label="主题中的代表和近期对话">
          <h4>里面有哪些</h4>
          {conversations.map((conversation, index) => (
            <div className="topic-conversation-row" key={conversation.conversationId}>
              <button type="button" onClick={() => onOpenSource(conversation.sourceRoute)}>
                <span>{conversation.title}</span>
                <small>{index < overview.profile.representativeConversations.length ? "代表" : "近期"} · {formatDate(conversation.occurredAt)}</small>
              </button>
              <button className="conversation-move" type="button" onClick={() => onReassign(conversation.conversationId)}>移动</button>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function uniqueConversations(items: TopicOverview["profile"]["representativeConversations"]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.conversationId)) return false;
    seen.add(item.conversationId);
    return true;
  });
}

function memoryTypeLabel(type: MemoryType): string {
  return ({ conversation: "对话", task: "任务", knowledge: "知识", problem: "问题", decision: "决策", event: "事件" } as Record<MemoryType, string>)[type];
}

function stripPublicFields(value: ModelSlotForm) {
  return { provider: value.provider, baseUrl: value.baseUrl, model: value.model, ...(value.apiKey ? { apiKey: value.apiKey } : {}) };
}

async function waitForJob(id: string, onProgress?: (status: JobRecord["status"]) => void): Promise<JobRecord> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const data = await fetchJson<{ ok: boolean; result: JobRecord; error?: string }>(`/api/jobs?id=${encodeURIComponent(id)}`);
    if (!data.ok) throw new Error(data.error ?? "任务状态读取失败");
    onProgress?.(data.result.status);
    if (data.result.status === "completed" || data.result.status === "failed") return data.result;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("后台任务等待超时");
}

function auditActionLabel(action: string): string {
  return ({ "agent.queried": "智能体查询", "project.updated": "修改主题", "conversation.reassigned": "移动对话", "memory.create": "保存本轮记忆", "memory.update": "更新记忆", "memory.merge": "合并记忆", "memory.ignore": "废弃记忆", "memory.supersede": "替代记忆", "model_config.updated": "更新模型配置", "job.enqueued": "任务入队", "job.completed": "任务完成", "job.failed": "任务失败", "external_search.executed": "外部搜索" } as Record<string, string>)[action] ?? action;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return (await response.json()) as T;
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function formatEvidence(item: AgentAnswer["evidence"][number]): string {
  if (item.parsed?.content) {
    const subject = item.parsed.subject ? `【${item.parsed.subject}】` : "";
    return `${subject}${item.parsed.content}`;
  }

  return item.text;
}

function formatEvidenceSource(item: AgentAnswer["evidence"][number]): string {
  if (item.sourceKind === "external" || /^https?:\/\//.test(item.file)) return "外部来源";
  if (item.sourceKind === "raw" || /normalized/i.test(item.file)) return "原文回查";
  if (item.sourceKind === "memory" || /memories\.jsonl$/i.test(item.file)) return "命中记忆";
  return "分类库依据";
}

function formatMatchReason(item: AgentAnswer["evidence"][number]): string {
  const keyword = item.query && item.query !== "date-filter" ? `命中关键词“${item.query}”` : "命中提问的时间范围";
  const relevance = item.score >= 28 ? "高相关" : item.score >= 16 ? "较相关" : "补充参考";
  return `使用原因：${keyword} · ${relevance}`;
}

function formatDate(value: string | undefined): string {
  if (!value) return "未知日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatPlatforms(routes: Array<{ platform?: string }>): string {
  const platforms = [...new Set(routes.map((route) => route.platform).filter(Boolean))];
  if (platforms.length === 0) return "未知来源";

  return platforms.map(formatPlatformName).join(" + ");
}

function formatPlatformName(platform: string | undefined): string {
  if (platform === "deepseek") return "DeepSeek";
  if (platform === "gemini") return "Gemini";
  return platform ?? "未知来源";
}
