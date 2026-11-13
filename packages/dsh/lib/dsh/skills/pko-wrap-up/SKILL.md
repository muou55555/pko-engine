---
name: pko-wrap-up
description: 会话收尾：更新 hot.md、追加今日日记、给出下次入口
user-invocable: true
disable-model-invocation: true
---

# 会话收尾

## 步骤

1. **重写 hot.md**：`50-Wiki/hot.md`，≤500 字，四个小节
   ```
   ## Last Updated
   ## Key Recent Facts
   ## Recent Changes
   ## Active Threads
   ```
   这是下次会话恢复上下文的唯一依赖，必须写。

2. **追加今日日记**：在 `70-Calendar/daily/<今天>.md` 末尾追加
   ```
   ## 会话产出 HH:MM
   - 做了什么
   - 关键决策
   - 下一步
   ```

3. **提醒 Inbox**：`glob 00-Inbox/**/*.md`，有文件就提一句。

4. **给下次入口**：一段话说明"下次从哪继续"。

## 注意

- hot.md 是**完整覆写**，不是追加
- 日记是**追加**，不要覆盖已有内容
