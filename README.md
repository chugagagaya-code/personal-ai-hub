# 个人人工智能中心（Personal AI Hub）

一个本地优先的个人记忆智能体：导入 DeepSeek / Gemini 聊天记录，自动聚类为主题，抽取可维护的长期记忆，再通过网页用纯文本检索回答问题。

本项目坚持：不使用 embedding 或向量数据库，召回采用 `ripgrep`（`rg`）与规则；真实聊天、生成索引、人工修正、审计数据库和 API 密钥只保存在运行者自己的设备上。

## 已实现功能

- 递归导入 `.json`、`.md`、`.txt`，支持 DeepSeek conversation mapping 和 Gemini Q/A 文本。
- 整批对话先聚成 N 个主题，再将逐段对话归簇；主题页展示概述、关键词、记忆构成、时间分布和代表对话。
- 保留 conversation 原文切片，同时规则抽取 `decision / task / problem / knowledge`。
- 优先检索分类知识库，证据不足或需要细节时回查标准化原始库。
- 识别时间线、召回、比较、总结、排障、计划、事实问题和追问意图。
- 回答提供内容简介和具体事项，必要时补充前情与当前困难。
- 右侧分为“本次回答依据”“本轮新增记忆”“记忆库管理”；新记忆必须人工确认。
- 支持记忆创建、更新、合并、替代、废弃，以及主题改名和对话人工改归。
- 支持 OpenAI-compatible 模型 A/B 配置、冲突处理接口和事实问题外搜接口。
- 使用本机 SQLite 保存审计记录和异步任务状态。

## 运行要求

- Node.js 22.5+（推荐 Node.js 24）
- pnpm 9+
- [ripgrep](https://github.com/BurntSushi/ripgrep)，执行 `rg --version` 应成功
- Windows、macOS 或 Linux

完整产品需求见 [REQUIREMENTS.md](./REQUIREMENTS.md)。JavaScript 依赖以 `package.json` 和 `pnpm-lock.yaml` 为准，本项目不需要 Python `requirements.txt`。

## 使用脱敏示例启动

```powershell
git clone https://github.com/chugagagaya-code/personal-ai-hub.git
Set-Location personal-ai-hub
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm run import:local
pnpm run dev
```

打开 <http://localhost:3000>。`.env.example` 默认指向仓库内的脱敏示例，不含作者聊天记录。

## 使用自己的聊天记录

把真实数据放在仓库之外，例如：

```text
D:\Private\my-ai-chats\
├─ deepseek-export\conversations.json
└─ gemini-export\conversation.md
```

复制 `.env.example` 为 `.env.local`，再修改：

```dotenv
PERSONAL_AI_SOURCE_DIR=D:/Private/my-ai-chats
PERSONAL_AI_DATA_DIR=./data
PERSONAL_AI_USER_ID=local
PERSONAL_AI_TOPIC_COUNT=12
```

执行 `pnpm run import:local` 后，生成结果保存在 `data/users/<user-id>/`，包括标准化对话、主题库、Memory、人工修正、模型配置、任务状态和审计数据库。整个 `data/` 已被 Git 忽略。

## 数据格式

DeepSeek JSON 使用官方导出的 conversation `mapping` 结构。Gemini Markdown/TXT 可以使用：

```markdown
# 对话标题
> 导出时间: 2026-08-01T10:00:00+08:00

**Q：**
用户问题

**A：**
AI 回答
```

无 Q/A 标记的 TXT 会作为一条 conversation 导入；无法识别的 JSON 会跳过。

## 模型配置

模型不是运行本地检索的必要条件；未配置时系统使用本地证据生成答案。可在网页“模型配置”中填写两个 OpenAI-compatible 服务，也可以在 `.env.local` 配置模型 A：

```dotenv
MODEL_GATEWAY_BASE_URL=https://provider.example/v1
MODEL_GATEWAY_API_KEY=replace-me
MODEL_GATEWAY_MODEL=model-name
MODEL_GATEWAY_PROVIDER=provider-name
MODEL_GATEWAY_TIMEOUT_MS=30000
MODEL_GATEWAY_MAX_RETRIES=1
```

密钥不得写进 `.env.example`、README、截图或提交记录。外部搜索只用于事实性问题，并依赖模型 A 自身具备实时联网能力。

## 常用命令

```powershell
pnpm run import:local  # 导入并重建主题与记忆
pnpm run dev           # 开发模式
pnpm run typecheck     # TypeScript 检查
pnpm run build         # 生产构建
```

## 推送前隐私检查

```powershell
git status --short
git diff -- . ':(exclude)pnpm-lock.yaml'
git ls-files | rg -i '(^|/)(data|原始数据|raw-data|private-data|exports)(/|$)|\.(jsonl|sqlite|sqlite3|db)$|(^|/)\.env($|\.)'
```

最后一条理想情况下只显示 `.env.example`。若出现真实数据，不要提交；先执行 `git rm --cached -- <文件>`，再完善 `.gitignore`。注意：`.gitignore` 只能阻止未跟踪文件，不能从已有 Git 历史中抹掉秘密。

## 当前边界

- 适合本地单用户、单进程运行，不是可直接公开部署的多用户 SaaS。
- 双 LLM argue 已预留模型 A/B 与轮数上限，完整多轮协议仍需完善。
- 异步队列是本地进程内 worker；多实例部署需要独立队列与并发锁。
- 外部搜索不是独立搜索引擎，仅在模型 A 能联网时有效。
- 自动聚类和规则抽取可能误判，需要人工改归与 Memory 修正。

## 许可证

当前未提供 `LICENSE`；在添加许可证之前，默认保留所有权利。
