/** Obsidian 模板种子（与 pko-vault 的 _templates 对应，占位符用 Templater 语法）。 */
export const TEMPLATE_FILES: Readonly<Record<string, string>> = {
  '_templates/daily-note.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
type: daily
tags: [daily]
week: <% tp.date.now("YYYY-[W]WW") %>
---

# <% tp.date.now("YYYY年MM月DD日 dddd") %>

## 🌅 今日目标
- [ ]
- [ ]
- [ ]

## 💼 工作

### 公司日常

### 大模型 / AI 工作

### 量化工作

### 科技分享

## 🏠 生活

### 运动
- 类型：
- 时长：

### 其他

## 💡 想法 / 发现

## 📚 会话亮点

## 🌙 今日复盘

**完成了**：

**未完成**：

**明日重点**：
- [ ]
`,
  '_templates/wiki-page.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
type: wiki
tags: []
source: extracted
status: seed
summary:
---

# 主题名称

> 一句话摘要

## 概述

## 详细内容

## 关键点

## 相关概念
- [[]]

## 参考来源
`,
  '_templates/zettelkasten-card.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
id: <% tp.date.now("YYMMDDHHmm") %>
type: card
tags: []
status: seed
source:
summary:
---

# 标题（一个清晰的原子概念）

## 核心观点

用自己的话，1–3 句话说清楚这个概念/想法。

## 详细说明

## 相关链接
- [[]]
`,
  '_templates/project.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
type: project
status: active
tags: []
summary:
deadline:
---

# 项目名称

## 目标

## 关键结果
- [ ]

## 进展记录

## 相关笔记
- [[]]
`,
  '_templates/article.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
type: article
status: draft
tags: []
summary:
source:
---

# 文章标题

> 来源与作者

## 摘要

## 关键论点

## 我的思考

## 引用与延伸
`,
  '_templates/book-note.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
type: reference
status: reading
tags: []
summary:
author:
---

# 书名

## 一句话评价

## 核心观点

## 摘录

## 对我的影响
`,
  '_templates/meeting.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
type: meeting
tags: [meeting]
summary:
participants:
---

# 会议主题

## 结论

## 决策

## 行动项
- [ ] 负责人 / 截止日

## 讨论记录
`,
  '_templates/weekly-note.md': `---
date: <% tp.date.now("YYYY-MM-DD") %>
type: weekly
tags: [weekly]
week: <% tp.date.now("YYYY-[W]WW") %>
summary:
---

# 本周回顾

## 本周完成

## 学到的事

## 下周三个优先事项
- [ ]
- [ ]
- [ ]
`,
}
