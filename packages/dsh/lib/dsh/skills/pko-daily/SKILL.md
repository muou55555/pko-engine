---
name: pko-daily
description: 每日启动：恢复上下文、列今日待办、提醒 Inbox
user-invocable: true
disable-model-invocation: true
---

# 每日启动

## 步骤

1. **拿上下文**：`pko_context`（不带参数 = 会话档，含 hot.md 与 north-star）。
2. **看今日日记**：读 `70-Calendar/daily/<今天>.md`；不存在就提示用模板建。
3. **看 Inbox**：`glob 00-Inbox/**/*.md`，列出待处理条目。
4. **看活跃项目**：读 `20-Projects/work/` 下 `status: active` 的页面标题。
5. **给建议**：结合 north-star，给 3 件今天最该做的事，格式简洁。

## 输出格式

```
今天建议聚焦：
1. …
2. …
3. …

Inbox 待处理：N 条
跟进中的项目：…
```
