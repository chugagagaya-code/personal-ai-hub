# Gemini 示例数据

这里只存放少量脱敏、虚构的公开示例。不要将真实聊天记录放入这个会被 Git 跟踪的目录。

导入器会递归读取数据源目录中的 `.json`、`.md` 和 `.txt` 文件。JSON 目前识别 DeepSeek 对话导出结构；Markdown/TXT 识别 Gemini `Q/A` 标记，没有标记的 TXT 会作为一条原始对话导入。
