---
name: pko-save
description: 把当前会话里有价值的内容沉淀进知识库（按内容类型路由到固定目录）
user-invocable: true
disable-model-invocation: true
---

# /pko-save — 会话沉淀

把当前会话里有价值的内容保存进知识库。

## 执行步骤

1. **识别值得留的东西**：技术解决方案、重要决策及原因、新学到的概念、有价值的代码、观点洞察。
   闲聊、临时调试输出不保存。

2. **判断路由**（与 vault 的 save 规则一致）

   | 内容 | 目标 |
   | --- | --- |
   | 技术方案 / 操作步骤 | `40-Resources/how-to/` |
   | 概念 / 原理 | `40-Resources/concepts/` + `80-Cards/` |
   | 工作决策 | `20-Projects/work/<对应项目>/` |
   | LLM / AI | `30-Areas/work/llm/` |
   | 量化 | `30-Areas/work/quant/` |
   | 生活类 | `30-Areas/life/<子目录>/` |
   | 今日亮点 | 追加到今日日记 |

3. **先查重**：`pko_query` 用主题词检索；已有同主题页就**更新**，不新建副本。

4. **写入**：`pko_capture`（单页）或 `pko_ingest`（多页）。写入用 `_templates/` 里对应的模板结构。

5. **更新 MOC**：在对应 `10-Atlas/moc-*.md` 加链接。
   写 `[[链接]]` 前先读 `50-Wiki/index.md` 与对应 MOC 确认文件存在；只链接已存在的文件，
   未创建的用纯文本提及。

6. **追加到今日日记**：`70-Calendar/daily/YYYY-MM-DD.md` 的「会话亮点」区块，
   按 `_templates/daily-note.md` 的结构。

7. **更新** `50-Wiki/log.md`（写入工具自动追加）与 `50-Wiki/hot.md`（收尾时统一重写）。

## 规则

保存前先告诉用户「将保存以下内容到 <路径>」，让用户确认再写。
