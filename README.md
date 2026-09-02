# Personal AI Hub

一个本地优先的个人记忆智能体。它将 AI 聊天记录分类到不同 Project，抽取结构化记忆，并使用纯文本检索回答问题。

> 真实聊天和生成数据仅应保存在运行者本地，不要提交到 GitHub。本仓库只放脱敏的 Gemini/通用文本示例，不放 DeepSeek 数据。

## 能力

- 数据源目录可递归读取 `.json`、`.md`、`.txt`。
- JSON 支持 DeepSeek 对话导出结构；Markdown/TXT 支持 Gemini Q/A 格式。
- 普通 TXT 即使没有 Q/A 标记，也会作为一条 conversation 导入。
- 基于规则分类 Project，并抽取 `decision / task / problem / knowledge`。
- 优先搜索分类知识库，信息不足时路由回查原文。
- 支持 Memory 更新、合并、替代和废弃。
- 使用 `rg`/grep 检索，不使用 embedding 或向量数据库。

## 环境

- Node.js 20+
- pnpm 9+
- ripgrep (`rg`)

## 快速开始

```bash
git clone https://github.com/YOUR_NAME/personal-ai-hub.git
cd personal-ai-hub
pnpm install
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
pnpm run import:local
pnpm run dev
```

然后打开 <http://localhost:3000>。`.env.example` 默认使用公开的脱敏示例。

## 使用自己的数据

1. 在仓库外准备一个私有数据源目录。
2. 放入 `.json`、`.md` 或 `.txt` 文件，可以使用子目录。
3. 复制 `.env.example` 为 `.env.local`。
4. 将 `PERSONAL_AI_SOURCE_DIR` 改为你的私有目录路径。
5. 执行 `pnpm run import:local`。

导入生成的索引位于 `data/`，已被 Git 忽略。

## 数据格式

Gemini Markdown/TXT 可使用以下标记：

```markdown
# 对话标题
> 导出时间: 2026-08-01T10:00:00+08:00

**Q：**
用户问题

**A：**
AI 回答
```

JSON 目前识别 DeepSeek 导出中的 conversation `mapping` 结构。不符合该结构的 JSON 会被忽略，不会被错当成对话。

## 环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PERSONAL_AI_SOURCE_DIR` | JSON/MD/TXT 数据源根目录 | `../原始数据` |
| `PERSONAL_AI_DATA_DIR` | 生成的索引和 Memory | `./data` |
| `PERSONAL_AI_USER_ID` | 本地用户数据分区 | `local` |

## 命令

```bash
pnpm run import:local  # 导入数据并重建知识库
pnpm run dev           # 启动开发服务器
pnpm run typecheck     # TypeScript 检查
pnpm run build         # 生产构建
```

## 隐私检查

`.gitignore` 已排除 `data/`、`原始数据/`、`raw-data/`、`.env*`、日志和本地数据库。每次推送前仍要执行 `git status`，人工确认没有真实姓名、账号、联系方式、对话 URL 或私密内容。

详细需求和当前边界见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 当前边界

- 双 LLM 争辩工具已有接口和轮数限制，但尚未接入真实模型提供商。
- 外部搜索工具仍待接入。
- 当前是本地单用户模式，不应直接作为多用户公网服务。

## License

尚未选择开源许可证。在添加 `LICENSE` 之前，默认保留所有权利。
