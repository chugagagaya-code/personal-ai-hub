"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentAnswer, MemoryRecord, MemoryType, Project, SourceLookupResult, SourceRoute } from "@/shared/types";

type ApiState = "idle" | "loading" | "success" | "error";

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

const memoryTypes: Array<"all" | MemoryType> = ["all", "conversation", "decision", "task", "problem", "knowledge"];

export function PersonalAiHubDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("personal-ai-hub");
  const [selectedMemoryType, setSelectedMemoryType] = useState<"all" | MemoryType>("all");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [query, setQuery] = useState("智能体 后端 grep project 分类知识库");
  const [searchMode, setSearchMode] = useState<"project" | "all">("project");
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const [projectsState, setProjectsState] = useState<ApiState>("idle");
  const [memoriesState, setMemoriesState] = useState<ApiState>("idle");
  const [queryState, setQueryState] = useState<ApiState>("idle");
  const [importState, setImportState] = useState<ApiState>("idle");
  const [sourceState, setSourceState] = useState<ApiState>("idle");
  const [sourceLookup, setSourceLookup] = useState<SourceLookupResult | null>(null);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    setSelectedMemoryIds([]);
    if (selectedProjectId) void loadMemories(selectedProjectId, selectedMemoryType, showInactive);
  }, [selectedProjectId, selectedMemoryType, showInactive]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

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
    if (data.result.length > 0 && !data.result.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(data.result[0].id);
    }
    setProjectsState("success");
  }

  async function loadMemories(projectId: string, type: "all" | MemoryType, includeInactive = showInactive) {
    setMemoriesState("loading");
    const params = new URLSearchParams({ projectId, limit: "80" });
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

  async function runImport() {
    setImportState("loading");
    setMessage("正在重新导入 DeepSeek JSON 和 Gemini Markdown...");
    const data = await fetchJson<{ ok: boolean; result?: { projectCount: number; messageCount: number }; error?: string }>(
      "/api/imports",
      { method: "POST" },
    );

    if (!data.ok) {
      setImportState("error");
      setMessage(data.error ?? "导入失败");
      return;
    }

    setImportState("success");
    setMessage(`导入完成：${data.result?.messageCount ?? 0} 条消息，${data.result?.projectCount ?? 0} 个项目。`);
    await loadProjects();
    await loadMemories(selectedProjectId, selectedMemoryType, showInactive);
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
    setQueryState("success");
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
        <aside className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Projects</p>
              <h1 className="title">Personal AI Hub</h1>
            </div>
            <button className="secondary-button" disabled={importState === "loading"} onClick={runImport}>
              {importState === "loading" ? "导入中" : "重新导入"}
            </button>
          </div>

          {message ? <div className={`message ${projectsState === "error" ? "error" : ""}`}>{message}</div> : null}

          <div className="sidebar-body">
            <div className="project-list">
              {projectsState === "loading" && projects.length === 0 ? <p className="empty">正在加载项目...</p> : null}
              {projects.map((project) => (
                <button
                  className={`project-button ${project.id === selectedProjectId ? "active" : ""}`}
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.id)}
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

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Agent Workspace</p>
              <h2 className="title">{selectedProject?.name ?? "选择一个项目"}</h2>
            </div>
            <span className="badge">{answer?.usedFallbackRawSearch ? "已回退原始库" : "分类库优先"}</span>
          </div>

          <div className="status-strip">
            <Metric label="项目数" value={projects.length} />
            <Metric label="显示记忆" value={memories.length} />
            <Metric label="结构化" value={memories.length - (memoryCounts.conversation ?? 0)} />
            <Metric label="证据数" value={answer?.evidence.length ?? 0} />
          </div>

          <div className="main-body">
            <div className="query-box">
              <textarea value={query} onChange={(event) => setQuery(event.target.value)} />
              <div className="toolbar">
                <div className="segmented" aria-label="查询模式">
                  <button
                    className={searchMode === "project" ? "active" : ""}
                    type="button"
                    onClick={() => setSearchMode("project")}
                  >
                    项目内查询
                  </button>
                  <button className={searchMode === "all" ? "active" : ""} type="button" onClick={() => setSearchMode("all")}>
                    全库查询
                  </button>
                  <button type="button" disabled>
                    外部搜索
                  </button>
                </div>
                <button className="primary-button" disabled={queryState === "loading"} onClick={askAgent}>
                  {queryState === "loading" ? "查询中" : "询问智能体"}
                </button>
              </div>
            </div>

            <div className="answer-area">
              {answer ? (
                <article className="answer-card">
                  <div className="memory-meta">
                    <span className="badge">{answer.status}</span>
                    <span className="badge">{answer.usedFallbackRawSearch ? "raw fallback" : "classified only"}</span>
                    {answer.deliberation ? <span className="badge">argue ready</span> : null}
                  </div>
                  <pre>{answer.answer}</pre>
                </article>
              ) : (
                <p className="empty">输入问题后，智能体会先查当前 project 的分类知识库；细节不够时再回到原始库。</p>
              )}

              {sourceState === "loading" ? <p className="empty">正在读取原始来源...</p> : null}
            </div>
          </div>
        </section>

        <aside className="panel evidence-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Memory & Evidence</p>
              <h2 className="section-title">记忆抽取结果</h2>
            </div>
            <span className="badge">{memoriesState === "loading" ? "刷新中" : selectedMemoryType}</span>
          </div>

          <div className="type-tabs">
            {memoryTypes.map((type) => (
              <button
                className={type === selectedMemoryType ? "active" : ""}
                key={type}
                onClick={() => setSelectedMemoryType(type)}
              >
                {type}
              </button>
            ))}
          </div>

          <label className="inactive-toggle">
            <input checked={showInactive} type="checkbox" onChange={(event) => setShowInactive(event.target.checked)} />
            显示已废弃 / 已合并 / 已替代
          </label>

          {selectedMemoryIds.length > 0 ? (
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
            <div className="memory-list">
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
            </div>

            {answer?.evidence.length ? (
              <>
                <h2 className="section-title evidence-title">查询证据</h2>
                <div className="evidence-list">
                  {answer.evidence.slice(0, 6).map((item) => (
                    <article className="evidence-card" key={`${item.file}-${item.line}-${item.query}`}>
                      <div className="evidence-meta">
                        <span className="badge">score {item.score}</span>
                        <span className="badge">{item.query}</span>
                        {item.parsed?.sourceRoutes?.length ? (
                          <span className="badge">{formatPlatforms(item.parsed.sourceRoutes)}</span>
                        ) : null}
                        {item.parsed?.occurredAt ? <span className="badge">{formatDate(item.parsed.occurredAt)}</span> : null}
                      </div>
                      <p>{truncate(formatEvidence(item), 260)}</p>
                      <button className="inline-link" type="button" onClick={() => openSource(item.parsed?.sourceRoutes?.[0])}>
                        查看原文
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      </div>

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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
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
