---
name: pko-daily
description: 每日启动：加载目标与上下文、准备今日日记、列出待办与待处理事项
user-invocable: true
disable-model-invocation: true
---

# /pko-daily — 每日启动

## 执行步骤

1. **读目标**：`brain/north-star.md`，确认当前阶段目标与优先级。
2. **读近期上下文**：`50-Wiki/hot.md`（也可用 `pko_context` 一次拿到两者）。
3. **准备今日日记**：`70-Calendar/daily/YYYY-MM-DD.md`
   - 已存在 → 直接用
   - 不存在 → 按 `_templates/daily-note.md` 创建（把日期占位替换成今天）
4. **今日待办**：从今日日记里提取 `- [ ]` 未完成项；没有就跳过。
5. **Inbox 待处理**：`glob 00-Inbox/*`，有文件就列出来提醒处理。
6. **活跃项目**：读 `20-Projects/work/` 下 `status: active` 的页面标题。
7. **给建议**：结合 north-star 与未完成项，输出今天最该做的 3 件事。

## 输出格式

```
今日聚焦：
1. …
2. …
3. …

待处理：
- Inbox：N 个文件
- 活跃项目：…
```
