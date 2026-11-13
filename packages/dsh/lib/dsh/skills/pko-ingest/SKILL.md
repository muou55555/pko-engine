---
name: pko-ingest
description: 把外部资料摄取进知识库：抓取 → 蒸馏 → 查重 → 入库 → 报告
user-invocable: true
disable-model-invocation: true
---

# 摄取

用户给了 URL、文件路径、或一段粘贴的文本；也可能只说"处理一下 Inbox"。

## 步骤

1. **取内容**
   - URL：用 `web_fetch`；Markdown 来源直接读
   - 本地文件：`read`
   - 粘贴文本：直接用
   - 只说"Inbox"：`glob 00-Inbox/**/*.md`，逐个处理

2. **判断类型**：技术方案 / 会议记录 / 工具评估 / 生活信息。类型决定落到哪个目录。

3. **查重（必做）**：先 `pko_query` 用主题词检索。已有同主题页面时**更新**而不是新建，避免 `-2` 副本堆积。

4. **蒸馏**：拆成 1–3 页，每页一个主题。每页写 `summary`，**措辞要和正文不同**（检索的摘要层靠这个）。

5. **入库**：`pko_ingest`
   ```json
   { "source": "https://…", "pages": [{ "path": "40-Resources/how-to/xxx.md", "body": "# 标题\n\n正文", "title": "标题" }] }
   ```
   `source` 决定幂等键；同一 source 内容未变时自动跳过。

6. **报告**：写了哪几页、跳过了哪几页、和哪些已有页面建立了双链。

## 质量标准

- 每页必须有「为什么重要」或「我的理解」段落
- 矛盾信息标 `> ⚠️ 待确认：…`
- 双链只指向确认存在的页面（用 `pko_query` 或 `pko_read` 确认）
- 不给结论贴金：推断出来的内容，正文里要说明依据
